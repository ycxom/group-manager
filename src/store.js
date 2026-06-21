import fs from 'fs'
import path from 'path'

export class DataStore {
  constructor(filePath) {
    this.filePath = filePath
    this.violations = this._load()
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
        return data.violations || {}
      }
    } catch (e) {
      console.error('[Store] 加载失败:', e.message)
    }
    return {}
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(this.filePath, JSON.stringify({
        violations: this.violations,
        lastUpdate: new Date().toISOString()
      }, null, 2))
    } catch (e) {
      console.error('[Store] 保存失败:', e.message)
    }
  }

  increment(userId) {
    this.violations[userId] = (this.violations[userId] || 0) + 1
    this._save()
    return this.violations[userId]
  }

  clear(userId) {
    delete this.violations[userId]
    this._save()
  }

  get(userId) {
    return this.violations[userId] || 0
  }

  all() {
    return { ...this.violations }
  }
}
