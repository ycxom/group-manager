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
 *   keyword.add     { groupId, keyword, recallOnly?, doKick?, doMute?, muteDuration? }
 *   keyword.remove  { groupId, keyword }
 *   keyword.update  { groupId, keyword, recallOnly?, doKick?, doMute?, muteDuration? }
 *
 * ── 豁免用户 ──────────────────────────────────────────────────────
 *   exempt.list     { groupId }
 *   exempt.add      { groupId, userId }
 *   exempt.remove   { groupId, userId }
 *
 * ── 违规记录 ──────────────────────────────────────────────────────
 *   violation.list    { groupId? }
 *   violation.clear   { userId, groupId? }
 *   violation.logs    { userId, groupId? }           每次触发的详细日志
 *   violation.history { userId, groupId }            入群提醒：该群及同组历史
 *
 * ── 配置 ──────────────────────────────────────────────────────────
 *   config.get
 *
 * ── Bot 适配器 ────────────────────────────────────────────────────
 *   event.message { groupId, userId, senderRole, messageId, segments }
 *   → { action:'noop'|'reply'|'recall'|'kick'|'mute'|'recall+kick'|'recall+mute'|
 *         'kick+mute'|'recall+kick+mute', text?, messageId?, kickGroups?, muteGroups?, muteDuration? }
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

  listen(httpServer) {
    // httpServer 存在时复用 HTTP 端口，path=/ws；否则独立监听 this.port
    if (httpServer) {
      this.wss = new WebSocketServer({ server: httpServer, path: '/ws' })
      console.log(`[Mgmt] 管理 WS 已挂载到 HTTP 服务器（路径 /ws）`)
    } else {
      this.wss = new WebSocketServer({ port: this.port, host: '::' })
      this.wss.on('error', (e) => console.error(`[Mgmt] WS 启动失败: ${e.message}`))
      console.log(`[Mgmt] 管理 WS 服务已启动，端口 ${this.port} (all interfaces)`)
    }

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

      // 文字检测同步完成（毫秒级）
      const textAction = await this.recall.processTextMessage(event)
      if (textAction) {
        return this._reply(ws, true, this._buildBotResult(textAction), _id)
      }

      // 含图片时立即回复 noop，图片分析在后台进行，完成后推送给 bot
      const hasImage = (segments || []).some(s => s.type === 'image' && s.url)
      if (hasImage) {
        this._reply(ws, true, { action: 'noop' }, _id)
        this.recall.processImageMessage(event)
          .then(result => {
            if (result?.action) {
              this._pushToBots({ event: { type: 'action', ...this._buildBotResult(result) } })
            } else {
              this.recall._emit({ type: 'scan', groupId, userId, ocr: result?.ocr || null, qr: result?.qr || null })
            }
          })
          .catch(e => console.error('[Mgmt] 异步图片分析异常:', e.message))
        return
      }

      this.recall._emit({ type: 'scan', groupId, userId })
      return this._reply(ws, true, { action: 'noop' }, _id)
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
      const fields = {}
      if (msg.enabled       !== undefined) fields.enabled        = msg.enabled ? 1 : 0
      if (msg.maxViolations !== undefined) fields.max_violations = Number(msg.maxViolations)
      db.upsertGroup(Number(msg.groupId), fields)
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
      const opts = { doRecall: msg.doRecall !== undefined ? (msg.doRecall ? 1 : 0) : 1, recallOnly: msg.recallOnly ? 1 : 0, doKick: msg.doKick ? 1 : 0, doMute: msg.doMute ? 1 : 0, muteDuration: msg.muteDuration ?? 600 }
      return this._reply(ws, true, { added: db.addKeyword(gid, String(msg.keyword), null, opts) }, _id)
    }
    if (cmd === 'keyword.remove') {
      if (!msg.keyword) return this._reply(ws, false, '缺少 keyword', _id)
      const gid = msg.groupId !== undefined ? Number(msg.groupId) : 0
      return this._reply(ws, true, { removed: db.removeKeyword(gid, String(msg.keyword)) }, _id)
    }
    if (cmd === 'keyword.update') {
      if (!msg.keyword) return this._reply(ws, false, '缺少 keyword', _id)
      const gid = msg.groupId !== undefined ? Number(msg.groupId) : 0
      const opts = {}
      if (msg.doRecall     !== undefined) opts.doRecall     = msg.doRecall     ? 1 : 0
      if (msg.recallOnly   !== undefined) opts.recallOnly   = msg.recallOnly   ? 1 : 0
      if (msg.doKick       !== undefined) opts.doKick       = msg.doKick       ? 1 : 0
      if (msg.doMute       !== undefined) opts.doMute       = msg.doMute       ? 1 : 0
      if (msg.muteDuration !== undefined) opts.muteDuration = Number(msg.muteDuration)
      return this._reply(ws, true, { updated: db.updateKeyword(gid, String(msg.keyword), opts) }, _id)
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
    if (cmd === 'violation.logs') {
      if (!msg.userId) return this._reply(ws, false, '缺少 userId', _id)
      const gid = msg.groupId !== undefined ? Number(msg.groupId) : null
      return this._reply(ws, true, { logs: db.listViolationLogs(Number(msg.userId), gid) }, _id)
    }
    if (cmd === 'violation.history') {
      if (!msg.userId || !msg.groupId) return this._reply(ws, false, '缺少 userId 或 groupId', _id)
      return this._reply(ws, true, db.getRelevantViolationHistory(Number(msg.userId), Number(msg.groupId)), _id)
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

  // 根据 action 构建发给 bot 的结果（含 kickGroups / muteGroups 计算）
  _buildBotResult(action) {
    const result = {
      action:       action.action,
      messageId:    action.messageId,
      groupId:      action.groupId,
      userId:       action.userId,
      muteDuration: action.muteDuration,
    }
    const doKick = action.action?.includes('kick')
    const doMute = action.action?.includes('mute')
    if (doKick || doMute) {
      const catIds = this.db.getGroupCategoryIds(action.groupId)
      let groupSet
      if (catIds.length > 0) {
        groupSet = new Set()
        for (const catId of catIds) {
          for (const g of this.db.getCategoryGroups(catId)) groupSet.add(g.group_id)
        }
      } else {
        groupSet = new Set([action.groupId])
      }
      if (doKick) result.kickGroups = [...groupSet]
      if (doMute) result.muteGroups = [...groupSet]
    }
    return result
  }

  // 仅向 bot 角色的 WS 客户端推送（用于图片异步结果）
  _pushToBots(msg) {
    const str = JSON.stringify(msg)
    for (const ws of this._clients) {
      if (ws.readyState === 1 && ws.role === 'bot') ws.send(str)
    }
  }
}
