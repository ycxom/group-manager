import { WebSocketServer } from 'ws'

/**
 * 管理 WebSocket 服务端。
 * 所有消息为 JSON，客户端可携带 _id（响应中原样返回）。
 *
 * ── 认证 ──────────────────────────────────────────────────────────
 *   { cmd:'auth', token, role?:'admin'|'bot' }
 *
 * ── 群组 ──────────────────────────────────────────────────────────
 *   group.list
 *   group.add          { groupId, maxViolations? }
 *   group.remove       { groupId }
 *   group.settings.set { groupId, maxViolations?, enabled? }
 *
 * ── 关键词（groupId=0 表示全局）────────────────────────────────────
 *   keyword.list    { groupId }
 *   keyword.add     { groupId, keyword }
 *   keyword.remove  { groupId, keyword }
 *
 * ── 豁免用户 ──────────────────────────────────────────────────────
 *   exempt.list     { groupId }
 *   exempt.add      { groupId, userId }
 *   exempt.remove   { groupId, userId }
 *
 * ── 违规记录 ──────────────────────────────────────────────────────
 *   violation.list  { groupId? }
 *   violation.clear { userId, groupId? }
 *
 * ── 配置 ──────────────────────────────────────────────────────────
 *   config.get
 *
 * ── Bot 适配器 ────────────────────────────────────────────────────
 *   event.message { groupId, userId, senderRole, messageId, segments }
 *   → { action:'noop'|'reply'|'recall'|'recall+kick', text?, messageId?, kickGroups? }
 *
 * ── 推送事件（认证后自动接收）────────────────────────────────────
 *   { event:{ type:'recall', groupId, userId, content, violations } }
 *   { event:{ type:'kick',   groupId, userId, violations } }
 */
export class ManagementServer {
  constructor(config, db, recall, port) {
    this.config = config
    this.db     = db
    this.recall = recall
    this.port   = port || 8765
    this._clients = new Set()

    recall.on((ev) => this._broadcast({ event: ev }))
  }

  listen() {
    this.wss = new WebSocketServer({ port: this.port, host: '::' })
    this.wss.on('error', (e) => console.error(`[Mgmt] WS 启动失败: ${e.message}`))
    console.log(`[Mgmt] 管理 WS 服务已启动，端口 ${this.port} (all interfaces)`)

    this.wss.on('connection', (ws) => {
      ws.authed = false
      ws.role   = 'admin'
      ws.on('message', (raw) => {
        let msg
        try { msg = JSON.parse(raw.toString()) } catch {
          return this._reply(ws, false, '无效 JSON')
        }
        this._handle(ws, msg).catch((e) => {
          console.error('[Mgmt] 异常:', e.message)
          this._reply(ws, false, '内部错误', msg._id)
        })
      })
      ws.on('close', () => this._clients.delete(ws))
      ws.on('error', () => this._clients.delete(ws))
    })
  }

  _reply(ws, ok, data, id) {
    if (ws.readyState !== 1) return
    const msg = ok ? { ok: true, data } : { ok: false, error: data }
    if (id !== undefined) msg._id = id
    ws.send(JSON.stringify(msg))
  }

  _broadcast(msg) {
    const str = JSON.stringify(msg)
    for (const ws of this._clients) if (ws.readyState === 1) ws.send(str)
  }

  async _handle(ws, msg) {
    const { cmd, _id } = msg
    const db = this.db

    // ── 认证 ──
    if (cmd === 'auth') {
      const expected = this.config.get('management.token', '')
      if (!expected || msg.token === expected) {
        ws.authed = true
        ws.role   = msg.role === 'bot' ? 'bot' : 'admin'
        this._clients.add(ws)
        return this._reply(ws, true, { message: '认证成功', role: ws.role }, _id)
      }
      return this._reply(ws, false, 'token 错误', _id)
    }

    if (!ws.authed) return this._reply(ws, false, '请先发送 auth 命令', _id)

    // ── Bot 适配器：消息事件 ──
    if (cmd === 'event.message') {
      const { groupId, userId, senderRole, messageId, segments } = msg

      const textSeg = (segments || []).find(s => s.type === 'text')
      const rawText = (textSeg?.text || '').trim()
      if (rawText.startsWith('#gm ')) {
        const resp = this.recall.processCommand(rawText, groupId, userId, senderRole)
        return this._reply(ws, true, { action: 'reply', text: resp?.reply ?? '' }, _id)
      }

      const event = { groupId, userId, senderRole: senderRole || 'member', messageId, messages: segments || [] }
      const action = await this.recall.processMessage(event, null)

      if (!action) {
        this.recall._emit({ type: 'scan', groupId, userId })
        return this._reply(ws, true, { action: 'noop' }, _id)
      }

      const result = { action: action.action, messageId: action.messageId, groupId, userId }
      if (action.action === 'recall+kick') {
        // 若群属于组别，踢出该组别内所有群；否则仅踢出当前群
        const catIds = db.getGroupCategoryIds(groupId)
        if (catIds.length > 0) {
          const kickSet = new Set()
          for (const catId of catIds) {
            for (const g of db.getCategoryGroups(catId)) kickSet.add(g.group_id)
          }
          result.kickGroups = [...kickSet]
        } else {
          result.kickGroups = [groupId]
        }
      }
      return this._reply(ws, true, result, _id)
    }

    // ── 群组管理 ──
    if (cmd === 'group.list') {
      return this._reply(ws, true, { groups: db.listGroups() }, _id)
    }
    if (cmd === 'group.add') {
      if (!msg.groupId) return this._reply(ws, false, '缺少 groupId', _id)
      db.upsertGroup(Number(msg.groupId), { max_violations: msg.maxViolations ?? 3 })
      return this._reply(ws, true, { ok: true }, _id)
    }
    if (cmd === 'group.remove') {
      if (!msg.groupId) return this._reply(ws, false, '缺少 groupId', _id)
      return this._reply(ws, true, { removed: db.removeGroup(Number(msg.groupId)) }, _id)
    }
    if (cmd === 'group.settings.set') {
      if (!msg.groupId) return this._reply(ws, false, '缺少 groupId', _id)
      const g = db.getGroup(Number(msg.groupId)) || {}
      db.upsertGroup(Number(msg.groupId), {
        enabled:        msg.enabled        ?? g.enabled ?? 1,
        max_violations: msg.maxViolations  ?? g.max_violations ?? 3
      })
      return this._reply(ws, true, { ok: true }, _id)
    }

    // ── 关键词 ──
    if (cmd === 'keyword.list') {
      const gid = msg.groupId !== undefined ? Number(msg.groupId) : 0
      return this._reply(ws, true, { keywords: db.listKeywords(gid) }, _id)
    }
    if (cmd === 'keyword.add') {
      if (!msg.keyword) return this._reply(ws, false, '缺少 keyword', _id)
      const gid = msg.groupId !== undefined ? Number(msg.groupId) : 0
      return this._reply(ws, true, { added: db.addKeyword(gid, String(msg.keyword)) }, _id)
    }
    if (cmd === 'keyword.remove') {
      if (!msg.keyword) return this._reply(ws, false, '缺少 keyword', _id)
      const gid = msg.groupId !== undefined ? Number(msg.groupId) : 0
      return this._reply(ws, true, { removed: db.removeKeyword(gid, String(msg.keyword)) }, _id)
    }

    // ── 豁免用户 ──
    if (cmd === 'exempt.list') {
      const gid = msg.groupId !== undefined ? Number(msg.groupId) : 0
      return this._reply(ws, true, { users: db.listExempt(gid) }, _id)
    }
    if (cmd === 'exempt.add') {
      if (!msg.userId) return this._reply(ws, false, '缺少 userId', _id)
      const gid = msg.groupId !== undefined ? Number(msg.groupId) : 0
      return this._reply(ws, true, { added: db.addExempt(gid, Number(msg.userId)) }, _id)
    }
    if (cmd === 'exempt.remove') {
      if (!msg.userId) return this._reply(ws, false, '缺少 userId', _id)
      const gid = msg.groupId !== undefined ? Number(msg.groupId) : 0
      return this._reply(ws, true, { removed: db.removeExempt(gid, Number(msg.userId)) }, _id)
    }

    // ── 违规记录 ──
    if (cmd === 'violation.list') {
      const gid = msg.groupId !== undefined ? Number(msg.groupId) : null
      return this._reply(ws, true, { violations: db.listViolations(gid) }, _id)
    }
    if (cmd === 'violation.clear') {
      if (!msg.userId) return this._reply(ws, false, '缺少 userId', _id)
      const gid = msg.groupId !== undefined ? Number(msg.groupId) : null
      db.clearViolation(Number(msg.userId), gid)
      return this._reply(ws, true, { cleared: true }, _id)
    }

    // ── 配置 ──
    if (cmd === 'config.get') {
      return this._reply(ws, true, {
        debug: this.config.get('debug'),
        maxViolations: this.config.get('maxViolations'),
        management: { port: this.config.get('management.port') }
      }, _id)
    }

    return this._reply(ws, false, `未知命令: ${cmd}`, _id)
  }
}
