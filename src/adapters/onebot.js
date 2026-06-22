import { WebSocket, WebSocketServer } from 'ws'

/**
 * OneBot v11 协议适配器。
 * 支持两种连接模式：
 *   forward  — 我们主动连接 bot 的 WS 服务端
 *   reverse  — bot 反向连接我们（我们开 WS 服务端）
 */
export class OneBotAdapter {
  constructor(botConfig, recall) {
    this.cfg = botConfig || {}
    this.recall = recall
    this.ws = null
    this._callId = 0
    this._pending = new Map()
    this._reconnectTimer = null
  }

  start(httpServer) {
    const mode = this.cfg.mode || 'forward'
    if (mode === 'reverse') {
      this._startReverseServer(httpServer)
    } else {
      this._connect()
    }
  }

  // ──────── Forward 模式 ────────

  _connect() {
    const url = this.cfg.url || 'ws://127.0.0.1:3001'
    const headers = this.cfg.token ? { Authorization: `Bearer ${this.cfg.token}` } : {}
    console.log(`[OneBot] 正在连接 ${url}`)

    this.ws = new WebSocket(url, { headers })

    this.ws.on('open', () => console.log('[OneBot] 已连接'))
    this.ws.on('message', (raw) => this._onRaw(raw))
    this.ws.on('close', () => {
      console.log('[OneBot] 连接断开，5s 后重连')
      this._reconnectTimer = setTimeout(() => this._connect(), 5000)
    })
    this.ws.on('error', (e) => console.error('[OneBot] 错误:', e.message))
  }

  // ──────── Reverse 模式 ────────

  _startReverseServer(httpServer) {
    let wss
    if (httpServer) {
      wss = new WebSocketServer({ server: httpServer, path: '/bot' })
      console.log(`[OneBot] 反向 WS 已挂载到 HTTP 服务器（路径 /bot）`)
    } else {
      const port = this.cfg.reversePort || 8080
      wss = new WebSocketServer({ port })
      console.log(`[OneBot] 反向 WS 服务端已启动，端口 ${port}，等待 bot 连接`)
    }

    wss.on('connection', (ws, req) => {
      const token = (req.headers['authorization'] || '').replace('Bearer ', '')
      if (this.cfg.token && token !== this.cfg.token) {
        ws.close(1008, 'Unauthorized')
        return
      }
      console.log('[OneBot] Bot 已反向连接')
      this.ws = ws
      ws.on('message', (raw) => this._onRaw(raw))
      ws.on('close', () => {
        console.log('[OneBot] Bot 断开连接')
        this.ws = null
      })
      ws.on('error', (e) => console.error('[OneBot] Bot WS 错误:', e.message))
    })
  }

  // ──────── 消息处理 ────────

  _onRaw(raw) {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }

    // API 调用响应
    if (msg.echo !== undefined) {
      const cb = this._pending.get(msg.echo)
      if (cb) {
        this._pending.delete(msg.echo)
        msg.status === 'ok' ? cb.resolve(msg.data) : cb.reject(new Error(msg.message || 'API error'))
      }
      return
    }

    if (msg.post_type === 'message' && msg.message_type === 'group') {
      this._handleGroupMessage(msg).catch((e) => console.error('[OneBot] 处理消息异常:', e.message))
    }
  }

  /** 将 OneBot v11 消息段规范化为 RecallManager 期望的格式 */
  _normalizeSegments(raw) {
    return (Array.isArray(raw) ? raw : []).map((seg) => {
      const type = seg.type
      const d = seg.data || {}
      if (type === 'text') return { type: 'text', text: d.text || '' }
      if (type === 'json') return { type: 'json', data: d.data || '' }
      if (type === 'forward') return { type: 'forward', id: d.id || '' }
      // icqqbot/NapCat 合并转发
      if (type === 'multimsg' || type === 'long_msg') return { type, id: d.resid || d.id || '' }
      return seg
    })
  }

  async _handleGroupMessage(raw) {
    const segments = this._normalizeSegments(raw.message)

    // 检测群管命令
    const textSeg = segments.find(s => s.type === 'text')
    if (textSeg?.text?.trimStart().startsWith('#gm ')) {
      const resp = this.recall.processCommand(textSeg.text.trim(), raw.user_id, raw.sender?.role || 'member')
      if (resp?.reply) {
        await this.sendGroupMsg(raw.group_id, resp.reply).catch(() => {})
      }
      return
    }

    const event = {
      groupId: raw.group_id,
      userId: raw.user_id,
      senderRole: raw.sender?.role || 'member',
      messageId: raw.message_id,
      messages: segments
    }

    const action = await this.recall.processMessage(event, (id) => this._getForwardMsg(id))
    if (!action) return

    // 撤回消息
    try {
      await this.deleteMsg(action.messageId)
      console.log(`[OneBot] 已撤回 群${action.groupId} 用户${action.userId}`)
    } catch (e) {
      console.error('[OneBot] 撤回失败:', e.message)
    }

    // 踢出全部白名单群
    if (action.action === 'recall+kick') {
      for (const gid of this.recall.config.get('whitelistGroups', [])) {
        await this.kickMember(gid, action.userId).catch((e) =>
          console.error(`[OneBot] 踢出 群${gid} 用户${action.userId} 失败:`, e.message)
        )
      }
    }
  }

  // ──────── OneBot API 调用 ────────

  _call(action, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('Bot WS 未连接'))
      }
      const echo = String(++this._callId)
      this._pending.set(echo, { resolve, reject })
      this.ws.send(JSON.stringify({ action, params, echo }))

      setTimeout(() => {
        if (this._pending.has(echo)) {
          this._pending.delete(echo)
          reject(new Error(`API 超时: ${action}`))
        }
      }, 10000)
    })
  }

  deleteMsg(messageId) {
    return this._call('delete_msg', { message_id: messageId })
  }

  kickMember(groupId, userId, reject = false) {
    return this._call('set_group_kick', { group_id: groupId, user_id: userId, reject_add_request: reject })
  }

  sendGroupMsg(groupId, text) {
    return this._call('send_group_msg', {
      group_id: groupId,
      message: [{ type: 'text', data: { text } }]
    })
  }

  _getForwardMsg(id) {
    return this._call('get_forward_msg', { id })
  }
}
