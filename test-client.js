/**
 * 测试客户端 — 覆盖 SQLite + 多群规则 + 管理员 + 豁免用户
 * 运行: node test-client.js  (先启动: node index.js)
 */
import { WebSocket } from 'ws'

const TOKEN = 'change-this-token'

class C {
  constructor() { this._ws = null; this._id = 0; this._p = new Map() }
  connect(url) {
    return new Promise((res, rej) => {
      this._ws = new WebSocket(url)
      this._ws.on('open', () => res())
      this._ws.on('error', rej)
      this._ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString())
        if (m._id !== undefined) { const cb = this._p.get(m._id); if (cb) { this._p.delete(m._id); cb(m) } }
      })
    })
  }
  call(cmd, params = {}) {
    return new Promise((res, rej) => {
      const id = ++this._id; this._p.set(id, res)
      this._ws.send(JSON.stringify({ cmd, ...params, _id: id }))
      setTimeout(() => { if (this._p.has(id)) { this._p.delete(id); rej(new Error('timeout')) } }, 5000)
    })
  }
  close() { this._ws.close() }
}

let pass = 0, fail = 0
function ok(label, r, check) {
  const v = r.ok && (check ? check(r.data) : true)
  if (v) { console.log(`  ✓ ${label}`); pass++ }
  else    { console.error(`  ✗ ${label}`, r.error || JSON.stringify(r.data)); fail++ }
  return r.ok ? r.data : null
}

async function run() {
  const c = new C()
  await c.connect('ws://127.0.0.1:8765')

  // ── 认证 ──
  console.log('\n=== 认证 ===')
  ok('auth OK',         await c.call('auth', { token: TOKEN }))

  // ── 群组 CRUD ──
  console.log('\n=== 群组管理 ===')
  ok('group.add A',     await c.call('group.add', { groupId: 100001, maxViolations: 2 }))
  ok('group.add B',     await c.call('group.add', { groupId: 100002, maxViolations: 5 }))
  const gl = ok('group.list', await c.call('group.list'), d => d.groups.some(g => g.group_id === 100001))
  if (gl) console.log('    groups:', gl.groups.map(g => `${g.group_id}(max=${g.max_violations})`).join(', '))

  ok('group.settings.set', await c.call('group.settings.set', { groupId: 100001, maxViolations: 3, enabled: 1 }))
  ok('group.settings disabled', await c.call('group.settings.set', { groupId: 100002, enabled: 0 }))

  // ── 关键词（全局 vs 群专属）──
  console.log('\n=== 关键词管理 ===')
  ok('kw.add global',   await c.call('keyword.add', { groupId: 0, keyword: '全局恶意词' }))
  ok('kw.add group A',  await c.call('keyword.add', { groupId: 100001, keyword: '群A专属词' }))
  ok('kw.add dup',      await c.call('keyword.add', { groupId: 0, keyword: '全局恶意词' }), d => !d.added) // 重复应返回 false

  const kl = ok('kw.list group 0', await c.call('keyword.list', { groupId: 0 }), d => d.keywords.some(k => k.keyword === '全局恶意词'))
  if (kl) console.log('    global kws:', kl.keywords.map(k => k.keyword).join(', '))

  ok('kw.remove group A', await c.call('keyword.remove', { groupId: 100001, keyword: '群A专属词' }))

  // ── 管理员 ──
  console.log('\n=== 管理员管理 ===')
  ok('admin.add root',     await c.call('admin.add', { groupId: 0,      userId: 88888, role: 'root'  }))
  ok('admin.add group A',  await c.call('admin.add', { groupId: 100001, userId: 77777, role: 'admin' }))
  const al = ok('admin.list all', await c.call('admin.list'), d => d.admins.length >= 2)
  if (al) console.log('    admins:', al.admins.map(a => `${a.user_id}(${a.role},g=${a.group_id})`).join(', '))

  ok('admin.list group A', await c.call('admin.list', { groupId: 100001 }), d => d.admins.some(a => a.user_id === 77777))
  ok('admin.remove',       await c.call('admin.remove', { groupId: 100001, userId: 77777 }))

  // ── 豁免用户 ──
  console.log('\n=== 豁免用户 ===')
  ok('exempt.add global',  await c.call('exempt.add', { groupId: 0,      userId: 55555 }))
  ok('exempt.add group A', await c.call('exempt.add', { groupId: 100001, userId: 44444 }))
  const el = ok('exempt.list', await c.call('exempt.list', { groupId: 0 }), d => d.users.some(u => u.user_id === 55555))
  if (el) console.log('    exempt:', el.users.map(u => u.user_id).join(', '))
  ok('exempt.remove',      await c.call('exempt.remove', { groupId: 0, userId: 55555 }))

  // ── Bot 事件协议 ──
  console.log('\n=== Bot 事件 ===')

  // 群 100001 启用, max=3; 群 100002 停用
  const r1 = await c.call('event.message', {
    groupId: 100001, userId: 11111, senderRole: 'member', messageId: 'e01',
    segments: [{ type: 'text', text: '普通消息' }]
  }); ok('noop（普通消息）', r1, d => d.action === 'noop')

  const r2 = await c.call('event.message', {
    groupId: 100001, userId: 11111, senderRole: 'member', messageId: 'e02',
    segments: [{ type: 'text', text: '全局恶意词出现了' }]
  }); ok('recall（全局关键词）', r2, d => d.action === 'recall')

  const r3 = await c.call('event.message', {
    groupId: 100002, userId: 11111, senderRole: 'member', messageId: 'e03',
    segments: [{ type: 'text', text: '全局恶意词出现了' }]
  }); ok('noop（群 100002 停用）', r3, d => d.action === 'noop')

  const r4 = await c.call('event.message', {
    groupId: 100001, userId: 11111, senderRole: 'admin', messageId: 'e04',
    segments: [{ type: 'text', text: '全局恶意词' }]
  }); ok('noop（admin 豁免）', r4, d => d.action === 'noop')

  // 豁免用户 44444 不触发
  const r5 = await c.call('event.message', {
    groupId: 100001, userId: 44444, senderRole: 'member', messageId: 'e05',
    segments: [{ type: 'text', text: '全局恶意词' }]
  }); ok('noop（exempt 用户）', r5, d => d.action === 'noop')

  // JSON 类型检测
  const r6 = await c.call('event.message', {
    groupId: 100001, userId: 22222, senderRole: 'member', messageId: 'e06',
    segments: [{ type: 'json', data: JSON.stringify({ app: 'com.tencent.tuwen.lua', prompt: 'test' }) }]
  }); ok('recall（JSON 命中）', r6, d => d.action === 'recall')

  // 违规累计到 max=3 → recall+kick
  const _r7a = await c.call('event.message', { groupId: 100001, userId: 33333, senderRole: 'member', messageId: 'e07a', segments: [{ type: 'text', text: '全局恶意词' }] })
  const _r7b = await c.call('event.message', { groupId: 100001, userId: 33333, senderRole: 'member', messageId: 'e07b', segments: [{ type: 'text', text: '[QQ收藏]' }] })
  const r7c  = await c.call('event.message', { groupId: 100001, userId: 33333, senderRole: 'member', messageId: 'e07c', segments: [{ type: 'text', text: '[QQ收藏]' }] })
  ok('recall+kick（违规满3次）', r7c, d => d.action === 'recall+kick' && Array.isArray(d.kickGroups))
  if (r7c.ok) console.log('    kickGroups:', r7c.data.kickGroups)

  // #gm keyword list 命令
  const r8 = await c.call('event.message', {
    groupId: 100001, userId: 88888, senderRole: 'member', messageId: 'e08',
    segments: [{ type: 'text', text: '#gm keyword list' }]
  }); ok('#gm keyword list (root)', r8, d => d.action === 'reply' && d.text.includes('关键词'))
  if (r8.ok) console.log('    reply:', r8.data.text.split('\n')[0])

  // ── 违规记录查询 ──
  console.log('\n=== 违规记录 ===')
  const vl = ok('violation.list all', await c.call('violation.list'), d => d.violations.length >= 0)
  if (vl) console.log('    violations:', vl.violations.length, '条')

  ok('violation.list group', await c.call('violation.list', { groupId: 100001 }))
  ok('violation.clear', await c.call('violation.clear', { userId: 22222, groupId: 100001 }))

  // ── 清理 ──
  await c.call('keyword.remove', { groupId: 0, keyword: '全局恶意词' })
  await c.call('admin.remove', { groupId: 0, userId: 88888 })
  await c.call('exempt.remove', { groupId: 100001, userId: 44444 })
  await c.call('group.remove', { groupId: 100001 })
  await c.call('group.remove', { groupId: 100002 })

  c.close()
  console.log(`\n完成: ${pass} 通过, ${fail} 失败`)
  if (fail > 0) process.exit(1)
}

run().catch(e => { console.error('测试异常:', e.message); process.exit(1) })
