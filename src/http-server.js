import { createServer } from 'http'
import { readFileSync, existsSync, statSync } from 'fs'
import { fileURLToPath } from 'url'
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Next.js 静态导出目录（npm run build 生成）
const OUT_DIR = path.resolve(__dirname, '..', 'web', 'out')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain; charset=utf-8',
}

// ── Password helpers (scrypt, sync, no deps) ─────────────────────────────

export function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(plain, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(plain, stored) {
  try {
    const [salt, hash] = stored.split(':')
    const inputBuf = scryptSync(plain, salt, 64)
    return timingSafeEqual(Buffer.from(hash, 'hex'), inputBuf)
  } catch { return false }
}

// ── Session store (in-memory, 24h TTL) ──────────────────────────────────

const SESSION_TTL = 24 * 60 * 60 * 1000
const sessions    = new Map()

function createSession(username, role) {
  const id = randomBytes(32).toString('hex')
  sessions.set(id, { username, role, expiresAt: Date.now() + SESSION_TTL })
  return id
}

function getSession(cookie) {
  const m = (cookie || '').match(/gm_session=([0-9a-f]+)/)
  if (!m) return null
  const s = sessions.get(m[1])
  if (!s) return null
  if (Date.now() > s.expiresAt) { sessions.delete(m[1]); return null }
  return { ...s, id: m[1] }
}

function deleteSession(cookie) {
  const m = (cookie || '').match(/gm_session=([0-9a-f]+)/)
  if (m) sessions.delete(m[1])
}

// ── Login rate limiting ───────────────────────────────────────────────────

const loginAttempts = new Map()  // ip → { count, resetAt }

function checkRateLimit(ip) {
  const now = Date.now()
  let e = loginAttempts.get(ip) || { count: 0, resetAt: now + 60_000 }
  if (now > e.resetAt) e = { count: 0, resetAt: now + 60_000 }
  e.count++
  loginAttempts.set(ip, e)
  return e.count <= 10  // 10 attempts / minute
}

// ── HTTP Server ───────────────────────────────────────────────────────────

export class HttpServer {
  constructor(config, db, recall) {
    this.config  = config
    this.db      = db
    this.recall  = recall
    this.uiPort  = config.get('management.uiPort', 8766)
    this._sseClients = new Map()  // res → sess

    // Forward recall/kick/scan events to SSE clients (filtered by session permissions)
    recall.on((ev) => this._sseEmit(ev))
  }

  listen() {
    this.server = createServer((req, res) => this._handle(req, res))
    this.server.on('error', (e) => console.error(`[UI] HTTP 服务启动失败: ${e.message}`))
    this.server.listen(this.uiPort, '::', () => {
      console.log(`[UI] 管理界面: http://localhost:${this.uiPort}  (all interfaces :: ${this.uiPort})`)
    })
    return this.server
  }

  // ── SSE ─────────────────────────────────────────────────────────────────

  _sseEmit(data) {
    const line = `data: ${JSON.stringify(data)}\n\n`
    for (const [res, sess] of this._sseClients) {
      try {
        // 有 groupId 的事件按权限过滤：非超管只收自己有权限的群的日志
        if (data.groupId && sess.role !== 'superadmin') {
          if (!this.db.hasGroupAccess(sess.username, data.groupId)) continue
        }
        res.write(line)
      } catch { this._sseClients.delete(res) }
    }
  }

  // ── Router ───────────────────────────────────────────────────────────────

  async _handle(req, res) {
    const url  = req.url.split('?')[0]
    const sess = getSession(req.headers.cookie)

    // SSE events stream (GET, requires session)
    if (req.method === 'GET' && url === '/events') {
      if (!sess) return this._err(res, 401, '请先登录')
      res.writeHead(200, {
        'Content-Type':  'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection':    'keep-alive',
        'X-Accel-Buffering': 'no'
      })
      res.write(`data: ${JSON.stringify({ type: 'connected', user: sess.username })}\n\n`)
      this._sseClients.set(res, sess)

      const ping = setInterval(() => {
        try { res.write(': ping\n\n') } catch { clearInterval(ping); this._sseClients.delete(res) }
      }, 25_000)

      req.on('close', () => { clearInterval(ping); this._sseClients.delete(res) })
      return
    }

    // 公开设置读取（登录页可用，无需 session）
    if (req.method === 'GET' && url === '/api/settings/wallpaper') {
      return this._json(res, 200, { ok: true, data: { url: this.db.getSetting('wallpaper_url') || '' } })
    }

    // 非 POST 请求 → 托管 Next.js 静态构建产物
    if (req.method !== 'POST') {
      return this._serveStatic(req, res)
    }

    // Require JSON content-type (implicit CSRF guard)
    const ct = req.headers['content-type'] || ''
    if (!ct.includes('application/json')) {
      res.writeHead(415); return res.end('Unsupported Media Type')
    }

    let body
    try {
      const raw = await new Promise((ok, rej) => {
        const chunks = []
        req.on('data', c => chunks.push(c))
        req.on('end', () => ok(Buffer.concat(chunks).toString()))
        req.on('error', rej)
      })
      body = JSON.parse(raw || '{}')
    } catch { return this._json(res, 400, { ok: false, error: '无效 JSON' }) }

    // ── Auth endpoints (no session required) ──
    if (url === '/login')  return this._login(req, res, body)
    if (url === '/logout') return this._logout(req, res)
    if (url === '/me')     return sess ? this._json(res, 200, { ok: true, data: { username: sess.username, role: sess.role, isDefaultPassword: this._isDefaultPwd(sess.username) } }) : this._err(res, 401, '未登录')

    // All /api/* require session
    if (!sess) return this._err(res, 401, '请先登录')

    const db = this.db
    const d  = body

    // ── Groups ──
    if (url === '/api/group/list') {
      const all = db.listGroups()
      if (sess.role === 'superadmin') return this._ok(res, { groups: all })
      const allowed = new Set(db.getUserGroups(sess.username))
      return this._ok(res, { groups: all.filter(g => allowed.has(g.group_id)) })
    }
    if (url === '/api/group/add') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可添加群组')
      if (!d.groupId) return this._err(res, 400, '缺少 groupId')
      db.upsertGroup(+d.groupId, { max_violations: d.maxViolations ?? 3 })
      return this._ok(res, { ok: true })
    }
    if (url === '/api/group/remove') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可移除群组')
      return this._ok(res, { removed: db.removeGroup(+d.groupId) })
    }
    if (url === '/api/group/settings') {
      if (!this._canAccess(sess, +d.groupId)) return this._err(res, 403, '无权访问该群')
      const g = db.getGroup(+d.groupId) || {}
      db.upsertGroup(+d.groupId, { enabled: d.enabled ?? g.enabled ?? 1, max_violations: d.maxViolations ?? g.max_violations ?? 3 })
      return this._ok(res, { ok: true })
    }

    // ── Keywords ──
    if (url === '/api/keyword/list') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      return this._ok(res, { keywords: db.listKeywords(gid) })
    }
    if (url === '/api/keyword/add') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      if (gid > 0 && db.isGroupInCategory(gid)) return this._err(res, 400, '该群已加入组别，请在组别中配置关键词')
      return this._ok(res, { added: db.addKeyword(gid, String(d.keyword), sess.username, { doRecall: d.doRecall !== undefined ? (d.doRecall ? 1 : 0) : 1, recallOnly: d.recallOnly ? 1 : 0, doKick: d.doKick ? 1 : 0, doMute: d.doMute ? 1 : 0, muteDuration: d.muteDuration ?? 600 }) })
    }
    if (url === '/api/keyword/remove') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      return this._ok(res, { removed: db.removeKeyword(gid, String(d.keyword)) })
    }
    if (url === '/api/keyword/update') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      const _kopts = {}
      if (d.doRecall     !== undefined) _kopts.doRecall     = d.doRecall     ? 1 : 0
      if (d.recallOnly   !== undefined) _kopts.recallOnly   = d.recallOnly   ? 1 : 0
      if (d.doKick       !== undefined) _kopts.doKick       = d.doKick       ? 1 : 0
      if (d.doMute       !== undefined) _kopts.doMute       = d.doMute       ? 1 : 0
      if (d.muteDuration !== undefined) _kopts.muteDuration = +d.muteDuration
      return this._ok(res, { updated: db.updateKeyword(gid, String(d.keyword), _kopts) })
    }

    // ── OCR Keywords ──
    if (url === '/api/ocr-keyword/list') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      return this._ok(res, { keywords: db.listOCRKeywords(gid) })
    }
    if (url === '/api/ocr-keyword/add') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      if (gid > 0 && db.isGroupInCategory(gid)) return this._err(res, 400, '该群已加入组别，请在组别中配置关键词')
      return this._ok(res, { added: db.addOCRKeyword(gid, String(d.keyword), sess.username, { doRecall: d.doRecall !== undefined ? (d.doRecall ? 1 : 0) : 1, recallOnly: d.recallOnly ? 1 : 0, doKick: d.doKick ? 1 : 0, doMute: d.doMute ? 1 : 0, muteDuration: d.muteDuration ?? 600 }) })
    }
    if (url === '/api/ocr-keyword/remove') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      return this._ok(res, { removed: db.removeOCRKeyword(gid, String(d.keyword)) })
    }
    if (url === '/api/ocr-keyword/update') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      const _oopts = {}
      if (d.doRecall     !== undefined) _oopts.doRecall     = d.doRecall     ? 1 : 0
      if (d.recallOnly   !== undefined) _oopts.recallOnly   = d.recallOnly   ? 1 : 0
      if (d.doKick       !== undefined) _oopts.doKick       = d.doKick       ? 1 : 0
      if (d.doMute       !== undefined) _oopts.doMute       = d.doMute       ? 1 : 0
      if (d.muteDuration !== undefined) _oopts.muteDuration = +d.muteDuration
      return this._ok(res, { updated: db.updateOCRKeyword(gid, String(d.keyword), _oopts) })
    }
    if (url === '/api/category/ocr-keyword/list') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      return this._ok(res, { keywords: db.listCategoryOCRKeywords(+d.categoryId) })
    }
    if (url === '/api/category/ocr-keyword/add') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      return this._ok(res, { added: db.addCategoryOCRKeyword(+d.categoryId, String(d.keyword), sess.username, { doRecall: d.doRecall !== undefined ? (d.doRecall ? 1 : 0) : 1, recallOnly: d.recallOnly ? 1 : 0, doKick: d.doKick ? 1 : 0, doMute: d.doMute ? 1 : 0, muteDuration: d.muteDuration ?? 600 }) })
    }
    if (url === '/api/category/ocr-keyword/remove') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      return this._ok(res, { removed: db.removeCategoryOCRKeyword(+d.categoryId, String(d.keyword)) })
    }
    if (url === '/api/category/ocr-keyword/update') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      const _coopts = {}
      if (d.doRecall     !== undefined) _coopts.doRecall     = d.doRecall     ? 1 : 0
      if (d.recallOnly   !== undefined) _coopts.recallOnly   = d.recallOnly   ? 1 : 0
      if (d.doKick       !== undefined) _coopts.doKick       = d.doKick       ? 1 : 0
      if (d.doMute       !== undefined) _coopts.doMute       = d.doMute       ? 1 : 0
      if (d.muteDuration !== undefined) _coopts.muteDuration = +d.muteDuration
      return this._ok(res, { updated: db.updateCategoryOCRKeyword(+d.categoryId, String(d.keyword), _coopts) })
    }

    // ── QR Keywords ──
    if (url === '/api/qr-keyword/list') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      return this._ok(res, { keywords: db.listQRKeywords(gid) })
    }
    if (url === '/api/qr-keyword/add') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      if (gid > 0 && db.isGroupInCategory(gid)) return this._err(res, 400, '该群已加入组别，请在组别中配置关键词')
      return this._ok(res, { added: db.addQRKeyword(gid, String(d.keyword), sess.username, { doRecall: d.doRecall !== undefined ? (d.doRecall ? 1 : 0) : 1, recallOnly: d.recallOnly ? 1 : 0, doKick: d.doKick ? 1 : 0, doMute: d.doMute ? 1 : 0, muteDuration: d.muteDuration ?? 600 }) })
    }
    if (url === '/api/qr-keyword/remove') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      return this._ok(res, { removed: db.removeQRKeyword(gid, String(d.keyword)) })
    }
    if (url === '/api/qr-keyword/update') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      const _qopts = {}
      if (d.doRecall     !== undefined) _qopts.doRecall     = d.doRecall     ? 1 : 0
      if (d.recallOnly   !== undefined) _qopts.recallOnly   = d.recallOnly   ? 1 : 0
      if (d.doKick       !== undefined) _qopts.doKick       = d.doKick       ? 1 : 0
      if (d.doMute       !== undefined) _qopts.doMute       = d.doMute       ? 1 : 0
      if (d.muteDuration !== undefined) _qopts.muteDuration = +d.muteDuration
      return this._ok(res, { updated: db.updateQRKeyword(gid, String(d.keyword), _qopts) })
    }
    if (url === '/api/category/qr-keyword/list') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      return this._ok(res, { keywords: db.listCategoryQRKeywords(+d.categoryId) })
    }
    if (url === '/api/category/qr-keyword/add') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      return this._ok(res, { added: db.addCategoryQRKeyword(+d.categoryId, String(d.keyword), sess.username, { doRecall: d.doRecall !== undefined ? (d.doRecall ? 1 : 0) : 1, recallOnly: d.recallOnly ? 1 : 0, doKick: d.doKick ? 1 : 0, doMute: d.doMute ? 1 : 0, muteDuration: d.muteDuration ?? 600 }) })
    }
    if (url === '/api/category/qr-keyword/remove') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      return this._ok(res, { removed: db.removeCategoryQRKeyword(+d.categoryId, String(d.keyword)) })
    }
    if (url === '/api/category/qr-keyword/update') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      const _cqopts = {}
      if (d.doRecall     !== undefined) _cqopts.doRecall     = d.doRecall     ? 1 : 0
      if (d.recallOnly   !== undefined) _cqopts.recallOnly   = d.recallOnly   ? 1 : 0
      if (d.doKick       !== undefined) _cqopts.doKick       = d.doKick       ? 1 : 0
      if (d.doMute       !== undefined) _cqopts.doMute       = d.doMute       ? 1 : 0
      if (d.muteDuration !== undefined) _cqopts.muteDuration = +d.muteDuration
      return this._ok(res, { updated: db.updateCategoryQRKeyword(+d.categoryId, String(d.keyword), _cqopts) })
    }

    // ── Exempt ──
    if (url === '/api/exempt/list') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      return this._ok(res, { users: db.listExempt(gid) })
    }
    if (url === '/api/exempt/add') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      if (gid > 0 && db.isGroupInCategory(gid)) return this._err(res, 400, '该群已加入组别，请在组别中配置豁免用户')
      return this._ok(res, { added: db.addExempt(gid, +d.userId) })
    }
    if (url === '/api/exempt/remove') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      return this._ok(res, { removed: db.removeExempt(gid, +d.userId) })
    }
    if (url === '/api/category/exempt/list') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      return this._ok(res, { users: db.listCategoryExempt(+d.categoryId) })
    }
    if (url === '/api/category/exempt/add') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      if (!d.userId) return this._err(res, 400, '缺少 userId')
      return this._ok(res, { added: db.addCategoryExempt(+d.categoryId, +d.userId) })
    }
    if (url === '/api/category/exempt/remove') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      if (!d.userId) return this._err(res, 400, '缺少 userId')
      return this._ok(res, { removed: db.removeCategoryExempt(+d.categoryId, +d.userId) })
    }

    // ── Image rules ──
    if (url === '/api/image-rules/get') {
      const scope = d.scope || 'global'
      const id = d.id != null ? +d.id : 0
      if (scope === 'category') {
        if (!this._canAccessCategory(sess, id)) return this._err(res, 403, '无权访问该组别')
        return this._ok(res, { rules: db.getCategoryImageRulesRaw(id) || {} })
      }
      if (scope === 'group') {
        if (!this._canAccess(sess, id)) return this._err(res, 403, '无权访问该群')
        return this._ok(res, { rules: db.getImageRulesRaw(id) || {} })
      }
      return this._ok(res, { rules: db.getImageRulesRaw(0) || {} })
    }
    if (url === '/api/image-rules/set') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可修改图片处理设置')
      const scope = d.scope || 'global'
      const id = d.id != null ? +d.id : 0
      const globalCols = ['qr_enabled','qr_block_all','ocr_enabled','ocr_langs','ocr_url',
                          'nsfw_enabled','nsfw_url','nsfw_key','nsfw_threshold',
                          'llm_enabled','llm_url','llm_key','llm_model','llm_prompt']
      const scopedCols = ['qr_enabled','qr_block_all','ocr_enabled','ocr_langs','ocr_url',
                          'nsfw_enabled','nsfw_threshold','llm_enabled']
      const allowed = scope === 'global' ? globalCols : scopedCols
      const fields = {}
      for (const k of allowed) if (k in d) fields[k] = d[k]
      if (scope === 'category') {
        db.setCategoryImageRules(id, fields)
      } else if (scope === 'group') {
        if (db.isGroupInCategory(id)) return this._err(res, 400, '该群已加入组别，请在组别中配置')
        db.setImageRules(id, fields)
      } else {
        db.setImageRules(0, fields)
      }
      return this._ok(res, { ok: true })
    }

    // ── Violations ──
    if (url === '/api/violation/list') {
      if (sess.role === 'superadmin') return this._ok(res, { violations: db.listViolations(d.groupId ?? null) })
      const allowed = new Set(db.getUserGroups(sess.username))
      const gid = d.groupId != null ? +d.groupId : null
      if (gid !== null) {
        if (!allowed.has(gid)) return this._err(res, 403, '无权访问该群')
        return this._ok(res, { violations: db.listViolations(gid) })
      }
      return this._ok(res, { violations: db.listViolations(null).filter(v => allowed.has(v.group_id)) })
    }
    if (url === '/api/violation/clear') {
      const gid = d.groupId != null ? +d.groupId : null
      if (gid !== null && !this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      if (gid === null && sess.role !== 'superadmin') return this._err(res, 403, '无权操作')
      db.clearViolation(+d.userId, gid)
      return this._ok(res, { cleared: true })
    }

    // ── Categories ──
    if (url === '/api/category/list') {
      const all = db.listCategories()
      if (sess.role === 'superadmin') return this._ok(res, { categories: all })
      const allowed = new Set(db.getUserCategoryIds(sess.username))
      return this._ok(res, { categories: all.filter(c => allowed.has(c.id)) })
    }
    if (url === '/api/category/add') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可添加组别')
      if (!d.name) return this._err(res, 400, '缺少 name')
      return this._ok(res, { added: db.addCategory(d.name.trim()) })
    }
    if (url === '/api/category/remove') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可删除组别')
      return this._ok(res, { removed: db.removeCategory(+d.categoryId) })
    }
    if (url === '/api/category/groups') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      return this._ok(res, { groups: db.getCategoryGroups(+d.categoryId) })
    }
    if (url === '/api/category/groups/add') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可管理组别成员')
      return this._ok(res, { added: db.addGroupToCategory(+d.groupId, +d.categoryId) })
    }
    if (url === '/api/category/groups/remove') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可管理组别成员')
      return this._ok(res, { removed: db.removeGroupFromCategory(+d.groupId, +d.categoryId) })
    }
    if (url === '/api/category/keyword/list') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      return this._ok(res, { keywords: db.listCategoryKeywords(+d.categoryId) })
    }
    if (url === '/api/category/keyword/add') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      if (!d.keyword) return this._err(res, 400, '缺少 keyword')
      return this._ok(res, { added: db.addCategoryKeyword(+d.categoryId, String(d.keyword), sess.username, { doRecall: d.doRecall !== undefined ? (d.doRecall ? 1 : 0) : 1, recallOnly: d.recallOnly ? 1 : 0, doKick: d.doKick ? 1 : 0, doMute: d.doMute ? 1 : 0, muteDuration: d.muteDuration ?? 600 }) })
    }
    if (url === '/api/category/keyword/remove') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      return this._ok(res, { removed: db.removeCategoryKeyword(+d.categoryId, String(d.keyword)) })
    }
    if (url === '/api/category/keyword/update') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      const _ckopts = {}
      if (d.doRecall     !== undefined) _ckopts.doRecall     = d.doRecall     ? 1 : 0
      if (d.recallOnly   !== undefined) _ckopts.recallOnly   = d.recallOnly   ? 1 : 0
      if (d.doKick       !== undefined) _ckopts.doKick       = d.doKick       ? 1 : 0
      if (d.doMute       !== undefined) _ckopts.doMute       = d.doMute       ? 1 : 0
      if (d.muteDuration !== undefined) _ckopts.muteDuration = +d.muteDuration
      return this._ok(res, { updated: db.updateCategoryKeyword(+d.categoryId, String(d.keyword), _ckopts) })
    }

    // ── User → Category authorization (superadmin only) ──
    if (url === '/api/user/categories/add') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可分配组别权限')
      if (!d.username || d.categoryId == null) return this._err(res, 400, '缺少参数')
      return this._ok(res, { added: db.addUserCategory(d.username, +d.categoryId) })
    }
    if (url === '/api/user/categories/remove') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可分配组别权限')
      if (!d.username || d.categoryId == null) return this._err(res, 400, '缺少参数')
      return this._ok(res, { removed: db.removeUserCategory(d.username, +d.categoryId) })
    }

    // ── Users ──
    if (url === '/api/user/list') {
      if (sess.role === 'superadmin') {
        const users = db.listUsers()
        for (const u of users) {
          u.groups     = db.getUserDirectGroups(u.username)
          u.categories = db.getUserCategories(u.username)
        }
        return this._ok(res, { users })
      }
      const user = db.getUser(sess.username)
      return this._ok(res, { users: [{
        id: user.id, username: user.username, role: user.role, created_at: user.created_at,
        groups:     db.getUserDirectGroups(sess.username),
        categories: db.getUserCategories(sess.username),
      }] })
    }
    if (url === '/api/user/add') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可添加用户')
      if (!d.username || !d.password) return this._err(res, 400, '缺少用户名或密码')
      const ok = db.addUser(d.username, hashPassword(d.password), d.role || 'admin')
      return this._ok(res, { added: ok })
    }
    if (url === '/api/user/remove') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可删除用户')
      if (d.username === sess.username) return this._err(res, 400, '不能删除自己')
      return this._ok(res, { removed: db.removeUser(d.username) })
    }
    if (url === '/api/user/password') {
      if (!d.oldPassword || !d.newPassword) return this._err(res, 400, '缺少参数')
      const user = db.getUser(sess.username)
      if (!user || !verifyPassword(d.oldPassword, user.password)) return this._err(res, 403, '当前密码错误')
      if (d.newPassword.length < 6) return this._err(res, 400, '新密码至少 6 位')
      db.updatePassword(sess.username, hashPassword(d.newPassword))
      return this._ok(res, { ok: true })
    }
    if (url === '/api/user/username') {
      const target = (d.username || sess.username).trim()
      if (!target) return this._err(res, 400, '缺少 username')
      if (target !== sess.username && sess.role !== 'superadmin') return this._err(res, 403, '无权修改他人用户名')
      const newUsername = (d.newUsername || '').trim()
      if (!newUsername || newUsername.length < 2) return this._err(res, 400, '用户名至少 2 位')
      if (newUsername === target) return this._err(res, 400, '新旧用户名相同')
      if (target === sess.username) {
        if (!d.password) return this._err(res, 400, '请输入当前密码确认')
        const user = db.getUser(sess.username)
        if (!user || !verifyPassword(d.password, user.password)) return this._err(res, 403, '密码错误')
      }
      if (!db.updateUsername(target, newUsername)) return this._err(res, 409, '用户名已被占用')
      if (target === sess.username) {
        const m = (req.headers.cookie || '').match(/gm_session=([0-9a-f]+)/)
        if (m) { const s = sessions.get(m[1]); if (s) s.username = newUsername }
      }
      return this._ok(res, { ok: true, newUsername })
    }

    // ── User → Group authorization (superadmin only for add/remove) ──
    if (url === '/api/user/groups/add') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可分配群权限')
      if (!d.username || d.groupId == null) return this._err(res, 400, '缺少参数')
      return this._ok(res, { added: db.addUserGroup(d.username, +d.groupId) })
    }
    if (url === '/api/user/groups/remove') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可分配群权限')
      if (!d.username || d.groupId == null) return this._err(res, 400, '缺少参数')
      return this._ok(res, { removed: db.removeUserGroup(d.username, +d.groupId) })
    }

    // ── Settings ──
    if (url === '/api/settings/wallpaper') {
      if (sess.role !== 'superadmin') return this._err(res, 403, '仅超级管理员可修改壁纸')
      const wallpaperUrl = typeof d.url === 'string' ? d.url.trim() : ''
      this.db.setSetting('wallpaper_url', wallpaperUrl || null)
      return this._ok(res, { ok: true })
    }

    res.writeHead(404); res.end('Not Found')
  }

  // ── Next.js 静态文件服务 ─────────────────────────────────────────────────

  _serveStatic(req, res) {
    if (!existsSync(OUT_DIR)) {
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end('<h1>前端尚未构建</h1><p>请在 <code>web/</code> 目录运行 <code>npm run build</code></p>')
    }

    let urlPath = req.url.split('?')[0]
    // 去除多余 .. 防路径穿越
    urlPath = urlPath.split('/').filter(s => s && s !== '..').join('/')
    if (!urlPath || urlPath === '/') urlPath = ''

    const base = path.join(OUT_DIR, urlPath)
    const candidates = [
      base,                             // /_next/static/…、favicon.ico 等直接文件
      base + '.html',                   // /keywords → keywords.html
      path.join(base, 'index.html'),    // /keywords/ → keywords/index.html
      path.join(OUT_DIR, '404.html'),   // 自定义 404
      path.join(OUT_DIR, 'index.html'), // SPA 兜底
    ]

    for (const filePath of candidates) {
      if (!path.resolve(filePath).startsWith(OUT_DIR)) continue
      try {
        if (!statSync(filePath).isFile()) continue
        const ext  = path.extname(filePath).toLowerCase()
        const mime = MIME[ext] || 'application/octet-stream'
        const cc   = filePath.includes(`${path.sep}_next${path.sep}static${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache'
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': cc })
        return res.end(readFileSync(filePath))
      } catch { continue }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }

  // ── Login / Logout ───────────────────────────────────────────────────────

  _login(req, res, body) {
    const ip = req.socket.remoteAddress
    if (!checkRateLimit(ip)) return this._err(res, 429, '登录尝试过于频繁，请 1 分钟后重试')

    const { username, password } = body
    if (!username || !password) return this._err(res, 400, '缺少用户名或密码')

    const user = this.db.getUser(username)
    if (!user || !verifyPassword(password, user.password)) {
      return this._err(res, 401, '用户名或密码错误')
    }

    const sid = createSession(user.username, user.role)
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `gm_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`
    })
    res.end(JSON.stringify({ ok: true, data: { username: user.username, role: user.role, isDefaultPassword: this._isDefaultPwd(user.username) } }))
  }

  _logout(req, res) {
    deleteSession(req.headers.cookie)
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'gm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
    })
    res.end(JSON.stringify({ ok: true }))
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _isDefaultPwd(username) {
    const user = this.db.getUser(username)
    return user ? verifyPassword('admin', user.password) : false
  }

  // ── Access control ────────────────────────────────────────────────────────

  // groupId=0 means global scope, only superadmin can access
  _canAccess(sess, groupId) {
    if (sess.role === 'superadmin') return true
    if (!groupId || groupId === 0) return false
    return this.db.hasGroupAccess(sess.username, groupId)
  }

  _canAccessCategory(sess, categoryId) {
    if (sess.role === 'superadmin') return true
    return this.db.hasCategoryAccess(sess.username, categoryId)
  }

  // ── Response helpers ─────────────────────────────────────────────────────

  _json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  _ok(res, data)        { this._json(res, 200, { ok: true, data }) }
  _err(res, code, msg)  { this._json(res, code, { ok: false, error: msg }) }
}
