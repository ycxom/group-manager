import fs from 'fs'
import path from 'path'

const DEFAULTS = {
  debug: false,
  maxViolations: 3,
  whitelistGroups: [],
  exemptUsers: [],
  rootUsers: [],
  recallKeywords: [
    'com.tencent.tuwen.lua',
    '[QQ收藏]',
    '一个人偷偷看',
    '60.221.240.12'
  ],
  bot: {
    url: 'ws://127.0.0.1:3001',
    token: '',
    // 'forward': 我们连 bot；'reverse': bot 连我们（需额外配置 reversePort）
    mode: 'forward',
    reversePort: 8080
  },
  management: {
    port: 8765,
    token: 'change-this-token'
  }
}

export class ConfigManager {
  constructor(filePath) {
    this.filePath = filePath
    this.data = this._load()
    this._watch()
  }

  _load() {
    if (!fs.existsSync(this.filePath)) {
      const examplePath = this.filePath.replace(/\.json$/, '.example.json')
      if (fs.existsSync(examplePath)) {
        fs.copyFileSync(examplePath, this.filePath)
        console.log(`[Config] 已从 config.example.json 创建 config.json，请修改配置后重启`)
      } else {
        this._write(DEFAULTS)
        console.log(`[Config] 已生成默认配置: ${this.filePath}，请修改后重启`)
      }
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
      return this._merge(DEFAULTS, raw)
    } catch (e) {
      console.error('[Config] 加载失败，使用默认配置:', e.message)
      return structuredClone(DEFAULTS)
    }
  }

  _watch() {
    let timer = null
    const reload = () => {
      if (!fs.existsSync(this.filePath)) return
      try {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
        this.data = this._merge(DEFAULTS, raw)
        console.log('[Config] 配置已热重载')
      } catch (e) {
        console.error('[Config] 热重载失败:', e.message)
      }
    }
    const watcher = fs.watch(this.filePath, () => {
      clearTimeout(timer)
      timer = setTimeout(reload, 300)
    })
    watcher.on('error', (e) => console.error('[Config] 文件监听错误:', e.message))
  }

  _merge(base, override) {
    const result = structuredClone(base)
    for (const [k, v] of Object.entries(override)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof result[k] === 'object') {
        result[k] = this._merge(result[k], v)
      } else {
        result[k] = v
      }
    }
    return result
  }

  _write(data) {
    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2))
  }

  save() {
    this._write(this.data)
  }

  get(key, defaultVal = undefined) {
    const parts = key.split('.')
    let val = this.data
    for (const p of parts) {
      if (val == null) return defaultVal
      val = val[p]
    }
    return val ?? defaultVal
  }

  addKeyword(keyword) {
    const kws = this.data.recallKeywords
    if (kws.includes(keyword)) return false
    kws.push(keyword)
    this.save()
    return true
  }

  removeKeyword(keyword) {
    const idx = this.data.recallKeywords.indexOf(keyword)
    if (idx < 0) return false
    this.data.recallKeywords.splice(idx, 1)
    this.save()
    return true
  }

  addGroup(groupId) {
    const groups = this.data.whitelistGroups
    if (groups.includes(groupId)) return false
    groups.push(groupId)
    this.save()
    return true
  }

  removeGroup(groupId) {
    const idx = this.data.whitelistGroups.indexOf(groupId)
    if (idx < 0) return false
    this.data.whitelistGroups.splice(idx, 1)
    this.save()
    return true
  }
}
