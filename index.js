import path from 'path'
import { fileURLToPath } from 'url'
import { ConfigManager }    from './src/config.js'
import { createDatabase }   from './src/db.js'
import { RecallManager }    from './src/recall.js'
import { OneBotAdapter }    from './src/adapters/onebot.js'
import { ManagementServer } from './src/mgmt-server.js'
import { HttpServer, hashPassword } from './src/http-server.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const config = new ConfigManager(path.join(__dirname, 'config.json'))
const db     = await createDatabase(path.join(__dirname, 'data', 'gm.sqlite'))

// 迁移旧 config.json 中的数据到 DB
db.migrateFromConfig(config)

const recall = new RecallManager(config, db)

recall.on((ev) => {
  if (ev.type === 'recall') console.log(`[事件] 撤回 群${ev.groupId} 用户${ev.userId} (第${ev.violations}次) — ${ev.content}`)
  else if (ev.type === 'kick') console.log(`[事件] 踢出 用户${ev.userId} 累计${ev.violations}次`)
})

// --reset-admin [password]  重置 admin 账户密码（不启动服务）
const resetIdx = process.argv.indexOf('--reset-admin')
if (resetIdx !== -1) {
  const newPwd = process.argv[resetIdx + 1] || 'admin'
  const hash   = hashPassword(newPwd)
  if (db.getUser('admin')) {
    db.updatePassword('admin', hash)
    console.log(`[Auth] admin 密码已重置为: ${newPwd}`)
  } else {
    db.addUser('admin', hash, 'superadmin')
    console.log(`[Auth] 已创建 admin 账户，密码: ${newPwd}`)
  }
  process.exit(0)
}

// 首次启动：创建默认 superadmin 账户
if (db.userCount() === 0) {
  db.addUser('admin', hashPassword('admin'), 'superadmin')
  console.log('[Auth] 已创建默认账户 admin/admin，请登录后立即修改密码！')
}

// Web UI（HTTP REST + SSE）—— 启动并获取共享 HTTP 服务器（升级路由由 HttpServer 统一管理）
const ui = new HttpServer(config, db, recall)
ui.listen()

// 管理 WS 服务端 —— 注册到 /ws
const mgmt = new ManagementServer(config, db, recall)
mgmt.listen(ui)

// Bot 适配器（forward 模式需要 url；reverse 模式只需 mode 字段）
const botMode = config.get('bot.mode', 'forward')
const botUrl  = config.get('bot.url', '')
if (botMode === 'reverse' || botUrl) {
  const bot = new OneBotAdapter(config.get('bot'), recall)
  bot.start(ui)  // reverse 模式注册到 /bot；forward 模式主动连接 botUrl
} else {
  console.log('[Bot] bot.url 未配置且非 reverse 模式，跳过 Bot 连接')
}

console.log('[GroupManager] 启动完成')
