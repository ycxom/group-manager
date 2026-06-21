import { createServer } from 'http'
import { readFileSync }  from 'fs'
import { fileURLToPath } from 'url'
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
    this._sseClients = new Set()  // res objects for SSE

    // Forward recall/kick events to SSE clients
    recall.on((ev) => this._sseEmit(ev))
  }

  listen() {
    const html = readFileSync(path.join(__dirname, 'ui', 'index.html'), 'utf8')
    const srv  = createServer((req, res) => this._handle(req, res, html))
    srv.on('error', (e) => console.error(`[UI] HTTP 服务启动失败: ${e.message}`))
    srv.listen(this.uiPort, '::', () => {
      console.log(`[UI] 管理界面: http://localhost:${this.uiPort}  (all interfaces :: ${this.uiPort})`)
    })
  }

  // ── SSE ─────────────────────────────────────────────────────────────────

  _sseEmit(data) {
    const line = `data: ${JSON.stringify(data)}\n\n`
    for (const res of this._sseClients) {
      try { res.write(line) } catch { this._sseClients.delete(res) }
    }
  }

  // ── Router ───────────────────────────────────────────────────────────────

  async _handle(req, res, html) {
    const url  = req.url.split('?')[0]
    const sess = getSession(req.headers.cookie)

    // Static HTML
    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      return res.end(html)
    }

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
      this._sseClients.add(res)

      const ping = setInterval(() => {
        try { res.write(': ping\n\n') } catch { clearInterval(ping); this._sseClients.delete(res) }
      }, 25_000)

      req.on('close', () => { clearInterval(ping); this._sseClients.delete(res) })
      return
    }

    // POST only from here
    if (req.method !== 'POST') {
      res.writeHead(405); return res.end('Method Not Allowed')
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
      return this._ok(res, { added: db.addKeyword(gid, String(d.keyword), sess.username) })
    }
    if (url === '/api/keyword/remove') {
      const gid = d.groupId ?? 0
      if (!this._canAccess(sess, gid)) return this._err(res, 403, '无权访问该群')
      return this._ok(res, { removed: db.removeKeyword(gid, String(d.keyword)) })
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
      return this._ok(res, { added: db.addCategoryKeyword(+d.categoryId, String(d.keyword), sess.username) })
    }
    if (url === '/api/category/keyword/remove') {
      if (!this._canAccessCategory(sess, +d.categoryId)) return this._err(res, 403, '无权访问该组别')
      return this._ok(res, { removed: db.removeCategoryKeyword(+d.categoryId, String(d.keyword)) })
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

    res.writeHead(404); res.end('Not Found')
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
