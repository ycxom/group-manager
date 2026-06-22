import { analyzeImage } from './image-processor.js'

/**
 * 核心群管逻辑，与协议无关。
 * 消息段格式（统一）：
 *   { type:'text',    text:'...' }
 *   { type:'json',    data:'{"app":"..."}' }
 *   { type:'forward', id:'...', nodes?:[...] }  nodes 已预取时直接用
 *   { type:'image',   url:'...' }
 */
export class RecallManager {
  constructor(config, db) {
    this.config = config
    this.db = db
    this._listeners = []
  }

  on(fn) {
    this._listeners.push(fn)
    return () => { this._listeners = this._listeners.filter(f => f !== fn) }
  }

  _emit(ev) { for (const fn of this._listeners) fn(ev) }

  // ──────── 关键词检测 ────────

  // keywords 元素可为字符串或 { keyword, recall_only }。命中返回 { keyword, recallOnly }，否则 null。
  _match(str, keywords) {
    for (const kw of keywords) {
      const word = typeof kw === 'string' ? kw : kw.keyword
      if (str.includes(word)) return { keyword: word, recallOnly: !!(kw.recall_only) }
    }
    return null
  }

  checkSegment(seg, keywords) {
    if (seg.type === 'json') {
      try {
        const obj = JSON.parse(seg.data)
        if (obj.app === 'com.tencent.tuwen.lua') {
          return { hit: true, content: obj.prompt || 'QQ收藏分享', recallOnly: false }
        }
        const m = this._match(JSON.stringify(obj), keywords)
        if (m) return { hit: true, content: obj.prompt || m.keyword, recallOnly: m.recallOnly }
      } catch {}
    }

    if (seg.type === 'text') {
      const text = seg.text || ''
      const m = this._match(text, keywords)
      if (m) return { hit: true, content: text.slice(0, 80), recallOnly: m.recallOnly }
    }

    return { hit: false }
  }

  async _scanNodes(nodes, keywords) {
    for (const node of nodes) {
      for (const seg of (node.message || [])) {
        const r = this.checkSegment(seg, keywords)
        if (r.hit) return { hit: true, content: `[转发] ${r.content}`, recallOnly: r.recallOnly }
      }
    }
    return { hit: false }
  }

  async _checkImage(url, rules, qrKeywords, ocrKeywords) {
    try {
      const r = await analyzeImage(url, rules)

      if ((rules.qr_enabled || rules.qr_block_all) && r.qr !== null) {
        if (rules.qr_block_all) return { hit: true, content: `[QR] ${r.qr.slice(0, 80) || '二维码'}`, recallOnly: false, ocr: r.ocr, qr: r.qr }
        if (qrKeywords.length) {
          const m = this._match(r.qr, qrKeywords)
          if (m) return { hit: true, content: `[QR] ${r.qr.slice(0, 80)}`, recallOnly: m.recallOnly, ocr: r.ocr, qr: r.qr }
        }
      }
      if (rules.ocr_enabled && r.ocr) {
        if (ocrKeywords.length) {
          const m = this._match(r.ocr, ocrKeywords)
          if (m) return { hit: true, content: `[OCR] ${r.ocr.slice(0, 80)}`, recallOnly: m.recallOnly, ocr: r.ocr, qr: r.qr }
        }
      }
      if (rules.nsfw_enabled && r.nsfw) {
        return { hit: true, content: '[涩图] 检测到不当内容', recallOnly: false, ocr: r.ocr, qr: r.qr }
      }
      if (rules.llm_enabled && r.llm?.startsWith('VIOLATION')) {
        return { hit: true, content: `[LLM] ${r.llm.replace('VIOLATION:', '').trim().slice(0, 80)}`, recallOnly: false, ocr: r.ocr, qr: r.qr }
      }
      return { hit: false, ocr: r.ocr, qr: r.qr }
    } catch (e) {
      console.error('[RecallMgr] 图片分析异常:', e.message)
      return { hit: false }
    }
  }

  // ──────── 主流程 ────────

  _guard(event) {
    const { groupId, userId, senderRole } = event
    if (!this.db.isGroupEnabled(groupId)) return false
    if (this.db.isExempt(groupId, userId)) return false
    if (senderRole === 'admin' || senderRole === 'owner') return false
    return true
  }

  _applyViolation(result, event) {
    const { groupId, userId, messageId } = event
    if (this.config.get('debug', false)) {
      console.log(`[RecallMgr] DEBUG 群${groupId} 用户${userId}: ${result.content}${result.recallOnly ? ' (仅撤回)' : ''}`)
      return null
    }
    // 仅撤回关键词：撤回消息但不计违规、不踢人
    if (result.recallOnly) {
      this._emit({ type: 'recall', groupId, userId, content: result.content, violations: 0, messageId, recallOnly: true })
      return { action: 'recall', messageId, groupId, userId, recallOnly: true }
    }
    const count = this.db.incrementViolation(userId, groupId, result.content)
    this._emit({ type: 'recall', groupId, userId, content: result.content, violations: count, messageId })
    const group = this.db.getGroup(groupId)
    const max = group?.max_violations ?? this.config.get('maxViolations', 3)
    if (count >= max) {
      this.db.clearViolation(userId, groupId)
      this._emit({ type: 'kick', groupId, userId, violations: count })
      return { action: 'recall+kick', messageId, groupId, userId }
    }
    return { action: 'recall', messageId, groupId, userId }
  }

  /** 同步检测：文字 / JSON / 转发消息，不检测图片，毫秒级返回 */
  async processTextMessage(event) {
    if (!this._guard(event)) return null
    const { groupId, messages } = event
    const keywords = this.db.getEffectiveKeywords(groupId)
    if (!keywords.length) return null

    let result = { hit: false }
    for (const seg of messages) {
      if (result.hit) break
      if (seg.type === 'forward' || seg.type === 'multimsg' || seg.type === 'long_msg') {
        const nodes = seg.nodes?.length ? seg.nodes : null
        if (nodes) result = await this._scanNodes(nodes, keywords)
      } else if (seg.type !== 'image') {
        result = this.checkSegment(seg, keywords)
      }
    }
    if (!result.hit) return null
    return this._applyViolation(result, event)
  }

  /** 异步检测：仅图片，可能耗时数秒，调用方应立即响应 bot 后再 await 此函数 */
  async processImageMessage(event) {
    if (!this._guard(event)) return null
    const { groupId, messages } = event
    const qrKeywords  = this.db.getEffectiveQRKeywords(groupId)
    const ocrKeywords = this.db.getEffectiveOCRKeywords(groupId)
    const imageRules  = this.db.getImageRules(groupId)
    const hasImgFeat  = imageRules && (imageRules.qr_enabled || imageRules.qr_block_all ||
                        imageRules.ocr_enabled || imageRules.nsfw_enabled || imageRules.llm_enabled)
    if (!hasImgFeat) return null

    let result = { hit: false }
    for (const seg of messages) {
      if (result.hit) break
      if (seg.type === 'image' && seg.url) {
        result = await this._checkImage(seg.url, imageRules, qrKeywords, ocrKeywords)
      }
    }
    if (!result.hit) return { action: null, ocr: result.ocr || null, qr: result.qr || null }
    return this._applyViolation(result, event)
  }

  /**
   * 兼容旧调用：文字 + 图片顺序检测（图片不异步，适用于非 WS 场景）
   * @param {{ groupId, userId, senderRole, messageId, messages }} event
   * @param {(id:string)=>Promise} fetchForward
   */
  async processMessage(event, fetchForward) {
    if (!this._guard(event)) return null
    const { groupId, messages } = event
    const keywords    = this.db.getEffectiveKeywords(groupId)
    const qrKeywords  = this.db.getEffectiveQRKeywords(groupId)
    const ocrKeywords = this.db.getEffectiveOCRKeywords(groupId)
    const imageRules  = this.db.getImageRules(groupId)
    const hasImgFeat  = imageRules && (imageRules.qr_enabled || imageRules.qr_block_all ||
                        imageRules.ocr_enabled || imageRules.nsfw_enabled || imageRules.llm_enabled)
    if (keywords.length === 0 && !hasImgFeat) return null

    let result = { hit: false }
    for (const seg of messages) {
      if (result.hit) break
      if (seg.type === 'forward' || seg.type === 'multimsg' || seg.type === 'long_msg') {
        const nodes = seg.nodes?.length ? seg.nodes : (fetchForward ? await fetchForward(seg.id || seg.resid).catch(() => null) : null)
        if (nodes && keywords.length) result = await this._scanNodes(nodes, keywords)
      } else if (seg.type === 'image' && seg.url && hasImgFeat) {
        result = await this._checkImage(seg.url, imageRules, qrKeywords, ocrKeywords)
      } else {
        if (keywords.length) result = this.checkSegment(seg, keywords)
      }
    }
    if (!result.hit) return null
    return this._applyViolation(result, event)
  }

  // ──────── 群内管理命令 ────────

  /**
   * @param {string} text
   * @param {number} groupId
   * @param {number} userId
   * @param {string} senderRole  'owner'|'admin'|'member'
   * @returns {{ reply:string }|null}
   */
  processCommand(text, groupId, userId, senderRole) {
    if (!text.startsWith('#gm ')) return null

    const isOwner = senderRole === 'owner'
    const isAdmin = senderRole === 'admin' || isOwner

    if (!isAdmin) return { reply: '无权限执行群管命令（需要群管理员或群主）' }

    const args = text.slice(4).trim().split(/\s+/)
    const sub  = args[0]

    // #gm keyword list|add <kw>|addonly <kw>|remove <kw>
    if (sub === 'keyword') {
      const op = args[1]
      const kw = args.slice(2).join(' ')

      if (op === 'list') {
        const list = this.db.getEffectiveKeywords(groupId)
        return { reply: `本群有效关键词 (${list.length}):\n${list.map((k, i) => `${i + 1}. ${k.keyword}${k.recall_only ? ' [仅撤回]' : ''}`).join('\n') || '(无)'}` }
      }

      if (!kw) return { reply: `用法: #gm keyword ${op} <关键词>` }

      if (op === 'add')     return { reply: this.db.addKeyword(groupId, kw, userId, 0) ? `已添加: ${kw}` : `已存在: ${kw}` }
      if (op === 'addonly') return { reply: this.db.addKeyword(groupId, kw, userId, 1) ? `已添加(仅撤回): ${kw}` : `已存在: ${kw}` }
      if (op === 'remove')  return { reply: this.db.removeKeyword(groupId, kw)         ? `已删除: ${kw}` : `不存在: ${kw}` }
      return { reply: '用法: #gm keyword add|addonly|remove|list [关键词]\n（addonly = 命中仅撤回，不计违规）' }
    }

    // #gm violations
    if (sub === 'violations') {
      const list = this.db.listViolations(groupId)
      return {
        reply: list.length
          ? `本群违规 (${list.length} 人):\n${list.map(r => `${r.user_id}: ${r.count} 次`).join('\n')}`
          : '本群暂无违规记录'
      }
    }

    // #gm clear <userId>  (仅群主)
    if (sub === 'clear') {
      if (!isOwner) return { reply: '仅群主可清除违规记录' }
      const uid = Number(args[1])
      if (!uid) return { reply: '用法: #gm clear <QQ号>' }
      this.db.clearViolation(uid, groupId)
      return { reply: `已清除 ${uid} 在本群的违规记录` }
    }

    // #gm exempt add|remove <userId>  (仅群主)
    if (sub === 'exempt') {
      if (!isOwner) return { reply: '仅群主可管理豁免用户' }
      const op  = args[1]
      const uid = Number(args[2])
      if (!uid) return { reply: '用法: #gm exempt add|remove <QQ号>' }
      if (op === 'add')    return { reply: this.db.addExempt(groupId, uid)    ? `已豁免: ${uid}` : `已存在: ${uid}` }
      if (op === 'remove') return { reply: this.db.removeExempt(groupId, uid) ? `已取消豁免: ${uid}` : `不存在: ${uid}` }
    }

    return { reply: `未知子命令: ${sub}。可用: keyword / violations / clear / exempt` }
  }
}
