import plugin from '../../lib/plugins/plugin.js'
import { WebSocket } from 'ws'

const GM_WS_URL = 'ws://127.0.0.1:8766/ws'
const GM_TOKEN  = 'change-this-token'

// Module-level state — survives Yunzai re-instantiating the class per message
let _ws      = null
let _callId  = 0
const _pending = new Map()
let _ready   = false

function _call(msg) {
  return new Promise((resolve, reject) => {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) {
      return reject(new Error('WS 未连接'))
    }
    const id = ++_callId
    _pending.set(id, { resolve, reject })
    _ws.send(JSON.stringify({ ...msg, _id: id }))
    setTimeout(() => {
      if (_pending.has(id)) {
        _pending.delete(id)
        reject(new Error(`超时: ${msg.cmd}`))
      }
    }, 10000)
  })
}

function _connect() {
  _ws = new WebSocket(GM_WS_URL)
  _ws.on('open', () => {
    _call({ cmd: 'auth', token: GM_TOKEN, role: 'bot' })
      .then((data) => { _ready = true; console.log('[GM桥接] 已连接并认证:', data.message) })
      .catch((e) => console.error('[GM桥接] 认证失败:', e.message))
  })
  _ws.on('message', async (raw) => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    if (msg._id !== undefined) {
      const cb = _pending.get(msg._id)
      if (cb) {
        _pending.delete(msg._id)
        msg.ok ? cb.resolve(msg.data) : cb.reject(new Error(msg.error))
      }
      return
    }
    if (msg.event) {
      const ev = msg.event
      if (ev.type === 'action') {
        // 图片异步分析完成后由服务端推送的处置指令
        await _applyActions(ev)
      } else if (ev.type === 'recall') {
        console.log(`[GM桥接] 撤回 群${ev.groupId} 用户${ev.userId} 第${ev.violations}次`)
      } else if (ev.type === 'kick') {
        console.log(`[GM桥接] 踢出 用户${ev.userId} 累计${ev.violations}次`)
      }
    }
  })
  _ws.on('close', () => {
    _ready = false
    for (const [, cb] of _pending) cb.reject(new Error('连接断开'))
    _pending.clear()
    console.log('[GM桥接] 连接断开，5s 后重连')
    setTimeout(_connect, 5000)
  })
  _ws.on('error', (e) => console.error('[GM桥接] WS 错误:', e.message))
}

/** 统一执行处置动作（撤回 / 禁言 / 踢出），供同步和异步两条路径复用 */
async function _applyActions(data) {
  const act  = data.action || ''
  const uid  = data.userId
  const dur  = data.muteDuration || 600

  if (act.includes('recall') && data.messageId) {
    try {
      await Bot.pickGroup(data.groupId).recallMsg(data.messageId)
      console.log(`[GM桥接] 撤回 群${data.groupId} 用户${uid}`)
    } catch (err) {
      console.error('[GM桥接] 撤回失败:', err.message)
    }
  }
  if (act.includes('mute')) {
    for (const gid of (data.muteGroups || [])) {
      try {
        await Bot.pickGroup(gid).muteMember(uid, dur)
        console.log(`[GM桥接] 禁言 群${gid} 用户${uid} ${dur}s`)
      } catch (err) {
        console.error(`[GM桥接] 禁言失败 群${gid}:`, err.message)
      }
    }
  }
  if (act.includes('kick')) {
    for (const gid of (data.kickGroups || [])) {
      try {
        await Bot.pickGroup(gid).kickMember(uid)
        console.log(`[GM桥接] 踢出 群${gid} 用户${uid}`)
      } catch (err) {
        console.error(`[GM桥接] 踢出失败 群${gid}:`, err.message)
      }
    }
  }
}

// Connect once when the module is first loaded
_connect()

export class GroupManagerNotice extends plugin {
  constructor() {
    super({
      name: '群管-入群检测',
      dsc: '成员加群时查历史违规并提醒',
      event: 'notice.group.increase',
      priority: 9998,
      rule: [{ reg: '', fnc: 'onMemberJoin', log: false }]
    })
  }

  async onMemberJoin(e) {
    if (!_ready) return false
    const groupId = e.group_id
    const userId  = e.user_id

    let history
    try {
      history = await _call({ cmd: 'violation.history', userId, groupId })
    } catch (err) {
      console.error('[GM桥接] 查询违规历史失败:', err.message)
      return false
    }

    if (!history || history.total === 0) return false

    // 按群统计历史触发次数（不展示关键词，防止规避检测）
    const groupLines = history.groups
      .map(g => {
        const cnt = history.logs.filter(l => l.group_id === g.group_id).length
        if (!cnt) return null
        const lastLog = history.logs.filter(l => l.group_id === g.group_id).at(-1)
        const kickInfo = g.archived_at ? `，曾于 ${g.archived_at} 被移出` : ''
        return `  • 群${g.group_id}：触发 ${cnt} 次${kickInfo}（最近：${lastLog?.triggered_at || '-'}）`
      })
      .filter(Boolean)
      .join('\n')

    const notice = [
      `⚠️ 【群管提醒】成员 ${userId} 有历史违规记录，共触发 ${history.total} 次，请管理员注意：`,
      groupLines,
      '如需查阅完整日志，请登录后台管理界面。'
    ].join('\n')

    try {
      await Bot.pickGroup(groupId).sendMsg(notice)
    } catch (err) {
      console.error('[GM桥接] 发送入群提示失败:', err.message)
    }

    return false
  }
}

export class GroupManagerBridge extends plugin {
  constructor() {
    super({
      name: '群管桥接',
      dsc: '转发群消息到独立群管程序并执行其指令',
      event: 'message.group',
      priority: 9998,
      rule: [{ reg: '.*', fnc: 'handle', log: false }]
    })
  }

  _safeSeg(seg) {
    const type = String(seg?.type || 'unknown')
    if (type === 'text')  return { type, text: String(seg.text || '') }
    if (type === 'json')  return { type, data: String(seg.data || '') }
    if (type === 'image') return { type, url: String(seg.url || seg.file || '') }
    return { type }
  }

  async _normalizeSegments(message) {
    const result = []
    for (const seg of (message || [])) {
      const type = seg.type
      if (type === 'forward' || type === 'multimsg' || type === 'long_msg') {
        const id = String(seg.data?.id || seg.resid || '')
        let nodes = []
        if (id) {
          try {
            const raw = await Bot.getForwardMsg(id) || []
            nodes = raw.map(n => ({ message: (n.message || []).map(s => this._safeSeg(s)) }))
          } catch {}
        }
        result.push({ type: 'forward', id, nodes })
      } else {
        result.push(this._safeSeg(seg))
      }
    }
    return result
  }

  async handle(e) {
    if (!e.isGroup || !_ready) return false

    let segments
    try {
      segments = await this._normalizeSegments(e.message)
    } catch (err) {
      console.error('[GM桥接] 消息规范化失败:', err.message)
      return false
    }

    let data
    try {
      data = await _call({
        cmd:        'event.message',
        groupId:    e.group_id,
        userId:     e.user_id,
        senderRole: e.sender?.role || 'member',
        messageId:  e.message_id,
        segments
      })
    } catch (err) {
      console.error('[GM桥接] 事件转发失败:', err.message)
      return false
    }

    if (!data || data.action === 'noop') return false

    if (data.action === 'reply') {
      if (data.text) await e.group.sendMsg(data.text).catch(() => {})
      return false
    }

    if (data.action && data.action !== 'noop' && data.action !== 'reply') {
      await _applyActions(data)
    }

    return false
  }
}
