import initSqlJs from 'sql.js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SCHEMA = `
PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS groups (
  group_id       INTEGER PRIMARY KEY,
  enabled        INTEGER DEFAULT 1,
  max_violations INTEGER DEFAULT 3,
  created_at     TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS keywords (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER DEFAULT 0,
  keyword       TEXT NOT NULL,
  recall_only   INTEGER DEFAULT 0,
  do_kick       INTEGER DEFAULT 0,
  do_mute       INTEGER DEFAULT 0,
  mute_duration INTEGER DEFAULT 600,
  created_by    INTEGER,
  created_at    TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(group_id, keyword)
);
CREATE TABLE IF NOT EXISTS admins (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   INTEGER DEFAULT 0,
  user_id    INTEGER NOT NULL,
  role       TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(group_id, user_id)
);
CREATE TABLE IF NOT EXISTS exempt_users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id   INTEGER DEFAULT 0,
  user_id    INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(group_id, user_id)
);
CREATE TABLE IF NOT EXISTS violations (
  user_id      INTEGER NOT NULL,
  group_id     INTEGER NOT NULL,
  count        INTEGER DEFAULT 0,
  last_content TEXT    DEFAULT '',
  last_at      TEXT    DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (user_id, group_id)
);
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL UNIQUE,
  password   TEXT NOT NULL,
  role       TEXT DEFAULT 'admin',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS user_groups (
  username TEXT NOT NULL,
  group_id INTEGER NOT NULL,
  PRIMARY KEY (username, group_id)
);
CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS group_category (
  group_id    INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (group_id, category_id)
);
CREATE TABLE IF NOT EXISTS category_keywords (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id   INTEGER NOT NULL,
  keyword       TEXT NOT NULL,
  recall_only   INTEGER DEFAULT 0,
  do_kick       INTEGER DEFAULT 0,
  do_mute       INTEGER DEFAULT 0,
  mute_duration INTEGER DEFAULT 600,
  created_by    TEXT,
  created_at    TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(category_id, keyword)
);
CREATE TABLE IF NOT EXISTS user_categories (
  username    TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (username, category_id)
);
CREATE TABLE IF NOT EXISTS category_exempt_users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  created_at  TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(category_id, user_id)
);
CREATE TABLE IF NOT EXISTS ocr_keywords (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER DEFAULT 0,
  keyword       TEXT NOT NULL,
  recall_only   INTEGER DEFAULT 0,
  do_kick       INTEGER DEFAULT 0,
  do_mute       INTEGER DEFAULT 0,
  mute_duration INTEGER DEFAULT 600,
  created_by    TEXT,
  created_at    TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(group_id, keyword)
);
CREATE TABLE IF NOT EXISTS category_ocr_keywords (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id   INTEGER NOT NULL,
  keyword       TEXT NOT NULL,
  recall_only   INTEGER DEFAULT 0,
  do_kick       INTEGER DEFAULT 0,
  do_mute       INTEGER DEFAULT 0,
  mute_duration INTEGER DEFAULT 600,
  created_by    TEXT,
  created_at    TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(category_id, keyword)
);
CREATE TABLE IF NOT EXISTS qr_keywords (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id      INTEGER DEFAULT 0,
  keyword       TEXT NOT NULL,
  recall_only   INTEGER DEFAULT 0,
  do_kick       INTEGER DEFAULT 0,
  do_mute       INTEGER DEFAULT 0,
  mute_duration INTEGER DEFAULT 600,
  created_by    TEXT,
  created_at    TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(group_id, keyword)
);
CREATE TABLE IF NOT EXISTS category_qr_keywords (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id   INTEGER NOT NULL,
  keyword       TEXT NOT NULL,
  recall_only   INTEGER DEFAULT 0,
  do_kick       INTEGER DEFAULT 0,
  do_mute       INTEGER DEFAULT 0,
  mute_duration INTEGER DEFAULT 600,
  created_by    TEXT,
  created_at    TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(category_id, keyword)
);
CREATE TABLE IF NOT EXISTS violation_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  group_id     INTEGER NOT NULL,
  keyword      TEXT    DEFAULT '',
  content      TEXT    DEFAULT '',
  triggered_at TEXT    DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS image_rules (
  group_id       INTEGER PRIMARY KEY,
  qr_enabled     INTEGER DEFAULT 0,
  qr_block_all   INTEGER DEFAULT 0,
  ocr_enabled    INTEGER DEFAULT 0,
  ocr_langs      TEXT    DEFAULT 'chi_sim+eng',
  ocr_url        TEXT    DEFAULT '',
  nsfw_enabled   INTEGER DEFAULT 0,
  nsfw_url       TEXT    DEFAULT '',
  nsfw_key       TEXT    DEFAULT '',
  nsfw_threshold REAL    DEFAULT 0.7,
  llm_enabled    INTEGER DEFAULT 0,
  llm_url        TEXT    DEFAULT '',
  llm_key        TEXT    DEFAULT '',
  llm_model      TEXT    DEFAULT '',
  llm_prompt     TEXT    DEFAULT '',
  updated_at     TEXT    DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS category_image_rules (
  category_id    INTEGER PRIMARY KEY,
  qr_enabled     INTEGER,
  qr_block_all   INTEGER,
  ocr_enabled    INTEGER,
  ocr_langs      TEXT,
  ocr_url        TEXT,
  nsfw_enabled   INTEGER,
  nsfw_threshold REAL,
  llm_enabled    INTEGER,
  updated_at     TEXT    DEFAULT (datetime('now','localtime'))
);
`

export async function createDatabase(filePath) {
  const SQL = await initSqlJs({
    locateFile: (f) => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', f)
  })

  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
  const db  = new SQL.Database(raw)
  db.run(SCHEMA)

  // Migrations for columns added after initial release
  try { db.run("ALTER TABLE image_rules ADD COLUMN ocr_langs TEXT DEFAULT 'chi_sim+eng'") } catch {}
  try { db.run("ALTER TABLE image_rules ADD COLUMN ocr_url TEXT DEFAULT ''") } catch {}
  try { db.run("ALTER TABLE category_image_rules ADD COLUMN ocr_url TEXT") } catch {}
  try { db.run("ALTER TABLE violations ADD COLUMN last_content TEXT DEFAULT ''") } catch {}
  try { db.run("ALTER TABLE violations ADD COLUMN archived_at TEXT DEFAULT NULL") } catch {}
  // recall_only：命中后仅撤回，不计违规、不踢人
  try { db.run("ALTER TABLE keywords ADD COLUMN recall_only INTEGER DEFAULT 0") } catch {}
  try { db.run("ALTER TABLE category_keywords ADD COLUMN recall_only INTEGER DEFAULT 0") } catch {}
  try { db.run("ALTER TABLE ocr_keywords ADD COLUMN recall_only INTEGER DEFAULT 0") } catch {}
  try { db.run("ALTER TABLE category_ocr_keywords ADD COLUMN recall_only INTEGER DEFAULT 0") } catch {}
  try { db.run("ALTER TABLE qr_keywords ADD COLUMN recall_only INTEGER DEFAULT 0") } catch {}
  try { db.run("ALTER TABLE category_qr_keywords ADD COLUMN recall_only INTEGER DEFAULT 0") } catch {}
  // 关键词级处置方式：立即踢出 / 立即禁言 / 禁言时长
  for (const tbl of ['keywords','category_keywords','ocr_keywords','category_ocr_keywords','qr_keywords','category_qr_keywords']) {
    try { db.run(`ALTER TABLE ${tbl} ADD COLUMN do_kick       INTEGER DEFAULT 0`) } catch {}
    try { db.run(`ALTER TABLE ${tbl} ADD COLUMN do_mute       INTEGER DEFAULT 0`) } catch {}
    try { db.run(`ALTER TABLE ${tbl} ADD COLUMN mute_duration INTEGER DEFAULT 600`) } catch {}
    try { db.run(`ALTER TABLE ${tbl} ADD COLUMN do_recall     INTEGER DEFAULT 1`) } catch {}
  }

  const gm = new GM_Database(db, filePath)
  console.log('[DB] SQLite (sql.js) 初始化完成:', filePath)
  return gm
}

class GM_Database {
  constructor(sqlDb, filePath) {
    this._db   = sqlDb
    this._path = filePath
  }

  _save() {
    const data = this._db.export()
    fs.writeFileSync(this._path, Buffer.from(data))
  }

  /** 返回单行对象或 undefined */
  _get(sql, params = []) {
    const stmt = this._db.prepare(sql)
    stmt.bind(params)
    const row = stmt.step() ? stmt.getAsObject() : undefined
    stmt.free()
    return row
  }

  /** 返回行数组 */
  _all(sql, params = []) {
    const stmt = this._db.prepare(sql)
    stmt.bind(params)
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    return rows
  }

  /** 执行写操作，自动持久化 */
  _run(sql, params = []) {
    this._db.run(sql, params)
    this._save()
  }

  // ── Groups ─────────────────────────────────────────────────────────────

  listGroups() {
    const groups = this._all(`
      SELECT g.*,
        (SELECT COUNT(*) FROM keywords   WHERE group_id = g.group_id) AS keyword_count,
        (SELECT COUNT(*) FROM violations WHERE group_id = g.group_id) AS violation_count
      FROM groups g ORDER BY g.group_id
    `)
    const catRows = this._all(`
      SELECT gc.group_id, c.id, c.name FROM group_category gc
      JOIN categories c ON c.id = gc.category_id ORDER BY gc.group_id, c.name
    `)
    const catMap = {}
    for (const r of catRows) {
      ;(catMap[r.group_id] ??= []).push({ id: r.id, name: r.name })
    }
    for (const g of groups) g.categories = catMap[g.group_id] || []
    return groups
  }

  getGroup(groupId) {
    return this._get('SELECT * FROM groups WHERE group_id = ?', [groupId]) || null
  }

  upsertGroup(groupId, fields = {}) {
    const ex = this.getGroup(groupId) || {}
    const v = {
      enabled:        fields.enabled        ?? ex.enabled        ?? 1,
      max_violations: fields.max_violations ?? ex.max_violations ?? 3,
    }
    this._run(`
      INSERT INTO groups (group_id, enabled, max_violations) VALUES (?, ?, ?)
      ON CONFLICT(group_id) DO UPDATE SET enabled=excluded.enabled, max_violations=excluded.max_violations
    `, [groupId, v.enabled ? 1 : 0, v.max_violations])
  }

  removeGroup(groupId) {
    this._db.run('DELETE FROM group_category WHERE group_id=?', [groupId])
    this._db.run('DELETE FROM groups WHERE group_id=?', [groupId])
    const changed = this._db.getRowsModified() > 0
    this._save()
    return changed
  }

  isGroupEnabled(groupId) {
    const g = this.getGroup(groupId)
    return g ? g.enabled === 1 : false
  }

  // ── Keywords ────────────────────────────────────────────────────────────

  /**
   * 合并去重多来源关键词行。
   * recall_only：0（计违规）优先，避免降级执法力度。
   * do_kick / do_mute：任一来源开启则开启（取 OR）。
   * mute_duration：取两者中较大值。
   */
  _mergeKeywords(rows) {
    const map = new Map()
    for (const r of rows) {
      if (map.has(r.keyword)) {
        const cur = map.get(r.keyword)
        map.set(r.keyword, {
          keyword:       r.keyword,
          do_recall:     (cur.do_recall || r.do_recall) ? 1 : 0,
          recall_only:   cur.recall_only && r.recall_only ? 1 : 0,
          do_kick:       (cur.do_kick || r.do_kick) ? 1 : 0,
          do_mute:       (cur.do_mute || r.do_mute) ? 1 : 0,
          mute_duration: Math.max(cur.mute_duration || 600, r.mute_duration || 600),
        })
      } else {
        map.set(r.keyword, {
          keyword:       r.keyword,
          do_recall:     r.do_recall !== undefined ? (r.do_recall ? 1 : 0) : 1,
          recall_only:   r.recall_only ? 1 : 0,
          do_kick:       r.do_kick ? 1 : 0,
          do_mute:       r.do_mute ? 1 : 0,
          mute_duration: r.mute_duration || 600,
        })
      }
    }
    return [...map.values()].sort((a, b) => (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0))
  }

  getEffectiveKeywords(groupId) {
    const fromKw = this._all(
      'SELECT keyword, do_recall, recall_only, do_kick, do_mute, mute_duration FROM keywords WHERE group_id = 0 OR group_id = ?',
      [groupId]
    )
    const fromCat = this._all(`
      SELECT ck.keyword, ck.do_recall, ck.recall_only, ck.do_kick, ck.do_mute, ck.mute_duration FROM category_keywords ck
      JOIN group_category gc ON gc.category_id = ck.category_id
      WHERE gc.group_id = ?
    `, [groupId])
    return this._mergeKeywords([...fromKw, ...fromCat])
  }

  listKeywords(groupId) {
    return this._all(
      'SELECT id, group_id, keyword, do_recall, recall_only, do_kick, do_mute, mute_duration, created_by, created_at FROM keywords WHERE group_id = ? ORDER BY created_at',
      [groupId]
    )
  }

  addKeyword(groupId, keyword, createdBy = null, opts = {}) {
    const { doRecall = 1, recallOnly = 0, doKick = 0, doMute = 0, muteDuration = 600 } =
      typeof opts === 'number' ? { recallOnly: opts } : opts
    try {
      this._run(
        'INSERT INTO keywords (group_id, keyword, do_recall, recall_only, do_kick, do_mute, mute_duration, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [groupId, keyword, doRecall ? 1 : 0, recallOnly ? 1 : 0, doKick ? 1 : 0, doMute ? 1 : 0, muteDuration, createdBy])
      return true
    } catch { return false }
  }

  removeKeyword(groupId, keyword) {
    this._db.run('DELETE FROM keywords WHERE group_id = ? AND keyword = ?', [groupId, keyword])
    const changed = this._db.getRowsModified() > 0
    this._save()
    return changed
  }

  /** 通用：更新关键词处置选项（recallOnly / doKick / doMute / muteDuration 均可选传） */
  updateKeyword(groupId, keyword, opts = {}) {
    const sets = []
    const vals = []
    if (opts.doRecall    !== undefined) { sets.push('do_recall=?');     vals.push(opts.doRecall    ? 1 : 0) }
    if (opts.recallOnly  !== undefined) { sets.push('recall_only=?');   vals.push(opts.recallOnly  ? 1 : 0) }
    if (opts.doKick      !== undefined) { sets.push('do_kick=?');       vals.push(opts.doKick      ? 1 : 0) }
    if (opts.doMute      !== undefined) { sets.push('do_mute=?');       vals.push(opts.doMute      ? 1 : 0) }
    if (opts.muteDuration!== undefined) { sets.push('mute_duration=?'); vals.push(Number(opts.muteDuration)) }
    if (!sets.length) return false
    this._db.run(`UPDATE keywords SET ${sets.join(',')} WHERE group_id=? AND keyword=?`, [...vals, groupId, keyword])
    const changed = this._db.getRowsModified() > 0
    this._save()
    return changed
  }

  setKeywordRecallOnly(groupId, keyword, recallOnly) {
    return this.updateKeyword(groupId, keyword, { recallOnly })
  }

  // ── OCR Keywords ────────────────────────────────────────────────────────

  getEffectiveOCRKeywords(groupId) {
    const fromKw = this._all(
      'SELECT keyword, do_recall, recall_only, do_kick, do_mute, mute_duration FROM ocr_keywords WHERE group_id = 0 OR group_id = ?', [groupId]
    )
    const fromCat = this._all(`
      SELECT ck.keyword, ck.do_recall, ck.recall_only, ck.do_kick, ck.do_mute, ck.mute_duration FROM category_ocr_keywords ck
      JOIN group_category gc ON gc.category_id = ck.category_id
      WHERE gc.group_id = ?
    `, [groupId])
    return this._mergeKeywords([...fromKw, ...fromCat])
  }

  listOCRKeywords(groupId) {
    return this._all('SELECT * FROM ocr_keywords WHERE group_id=? ORDER BY created_at', [groupId])
  }

  addOCRKeyword(groupId, keyword, createdBy = null, opts = {}) {
    const { doRecall = 1, recallOnly = 0, doKick = 0, doMute = 0, muteDuration = 600 } =
      typeof opts === 'number' ? { recallOnly: opts } : opts
    try { this._run('INSERT INTO ocr_keywords (group_id, keyword, do_recall, recall_only, do_kick, do_mute, mute_duration, created_by) VALUES (?,?,?,?,?,?,?,?)', [groupId, keyword, doRecall ? 1 : 0, recallOnly ? 1 : 0, doKick ? 1 : 0, doMute ? 1 : 0, muteDuration, createdBy]); return true }
    catch { return false }
  }

  removeOCRKeyword(groupId, keyword) {
    this._db.run('DELETE FROM ocr_keywords WHERE group_id=? AND keyword=?', [groupId, keyword])
    const changed = this._db.getRowsModified() > 0; this._save(); return changed
  }

  updateOCRKeyword(groupId, keyword, opts = {}) {
    const sets = []; const vals = []
    if (opts.doRecall    !== undefined) { sets.push('do_recall=?');     vals.push(opts.doRecall    ? 1 : 0) }
    if (opts.recallOnly  !== undefined) { sets.push('recall_only=?');   vals.push(opts.recallOnly  ? 1 : 0) }
    if (opts.doKick      !== undefined) { sets.push('do_kick=?');       vals.push(opts.doKick      ? 1 : 0) }
    if (opts.doMute      !== undefined) { sets.push('do_mute=?');       vals.push(opts.doMute      ? 1 : 0) }
    if (opts.muteDuration!== undefined) { sets.push('mute_duration=?'); vals.push(Number(opts.muteDuration)) }
    if (!sets.length) return false
    this._db.run(`UPDATE ocr_keywords SET ${sets.join(',')} WHERE group_id=? AND keyword=?`, [...vals, groupId, keyword])
    const changed = this._db.getRowsModified() > 0; this._save(); return changed
  }

  setOCRKeywordRecallOnly(groupId, keyword, recallOnly) { return this.updateOCRKeyword(groupId, keyword, { recallOnly }) }

  listCategoryOCRKeywords(categoryId) {
    return this._all('SELECT * FROM category_ocr_keywords WHERE category_id=? ORDER BY created_at', [categoryId])
  }

  addCategoryOCRKeyword(categoryId, keyword, createdBy = null, opts = {}) {
    const { doRecall = 1, recallOnly = 0, doKick = 0, doMute = 0, muteDuration = 600 } =
      typeof opts === 'number' ? { recallOnly: opts } : opts
    try { this._run('INSERT INTO category_ocr_keywords (category_id, keyword, do_recall, recall_only, do_kick, do_mute, mute_duration, created_by) VALUES (?,?,?,?,?,?,?,?)', [categoryId, keyword, doRecall ? 1 : 0, recallOnly ? 1 : 0, doKick ? 1 : 0, doMute ? 1 : 0, muteDuration, createdBy]); return true }
    catch { return false }
  }

  removeCategoryOCRKeyword(categoryId, keyword) {
    this._db.run('DELETE FROM category_ocr_keywords WHERE category_id=? AND keyword=?', [categoryId, keyword])
    const changed = this._db.getRowsModified() > 0; this._save(); return changed
  }

  setCategoryOCRKeywordRecallOnly(categoryId, keyword, recallOnly) {
    const sets = ['recall_only=?']
    this._db.run(`UPDATE category_ocr_keywords SET ${sets.join(',')} WHERE category_id=? AND keyword=?`, [recallOnly ? 1 : 0, categoryId, keyword])
    const changed = this._db.getRowsModified() > 0; this._save(); return changed
  }

  updateCategoryOCRKeyword(categoryId, keyword, opts = {}) {
    const sets = []; const vals = []
    if (opts.doRecall    !== undefined) { sets.push('do_recall=?');     vals.push(opts.doRecall    ? 1 : 0) }
    if (opts.recallOnly  !== undefined) { sets.push('recall_only=?');   vals.push(opts.recallOnly  ? 1 : 0) }
    if (opts.doKick      !== undefined) { sets.push('do_kick=?');       vals.push(opts.doKick      ? 1 : 0) }
    if (opts.doMute      !== undefined) { sets.push('do_mute=?');       vals.push(opts.doMute      ? 1 : 0) }
    if (opts.muteDuration!== undefined) { sets.push('mute_duration=?'); vals.push(Number(opts.muteDuration)) }
    if (!sets.length) return false
    this._db.run(`UPDATE category_ocr_keywords SET ${sets.join(',')} WHERE category_id=? AND keyword=?`, [...vals, categoryId, keyword])
    const changed = this._db.getRowsModified() > 0; this._save(); return changed
  }

  // ── QR Keywords ─────────────────────────────────────────────────────────

  getEffectiveQRKeywords(groupId) {
    const fromKw = this._all(
      'SELECT keyword, do_recall, recall_only, do_kick, do_mute, mute_duration FROM qr_keywords WHERE group_id = 0 OR group_id = ?', [groupId]
    )
    const fromCat = this._all(`
      SELECT ck.keyword, ck.do_recall, ck.recall_only, ck.do_kick, ck.do_mute, ck.mute_duration FROM category_qr_keywords ck
      JOIN group_category gc ON gc.category_id = ck.category_id
      WHERE gc.group_id = ?
    `, [groupId])
    return this._mergeKeywords([...fromKw, ...fromCat])
  }

  listQRKeywords(groupId) {
    return this._all('SELECT * FROM qr_keywords WHERE group_id=? ORDER BY created_at', [groupId])
  }

  addQRKeyword(groupId, keyword, createdBy = null, opts = {}) {
    const { doRecall = 1, recallOnly = 0, doKick = 0, doMute = 0, muteDuration = 600 } =
      typeof opts === 'number' ? { recallOnly: opts } : opts
    try { this._run('INSERT INTO qr_keywords (group_id, keyword, do_recall, recall_only, do_kick, do_mute, mute_duration, created_by) VALUES (?,?,?,?,?,?,?,?)', [groupId, keyword, doRecall ? 1 : 0, recallOnly ? 1 : 0, doKick ? 1 : 0, doMute ? 1 : 0, muteDuration, createdBy]); return true }
    catch { return false }
  }

  removeQRKeyword(groupId, keyword) {
    this._db.run('DELETE FROM qr_keywords WHERE group_id=? AND keyword=?', [groupId, keyword])
    const changed = this._db.getRowsModified() > 0; this._save(); return changed
  }

  updateQRKeyword(groupId, keyword, opts = {}) {
    const sets = []; const vals = []
    if (opts.doRecall    !== undefined) { sets.push('do_recall=?');     vals.push(opts.doRecall    ? 1 : 0) }
    if (opts.recallOnly  !== undefined) { sets.push('recall_only=?');   vals.push(opts.recallOnly  ? 1 : 0) }
    if (opts.doKick      !== undefined) { sets.push('do_kick=?');       vals.push(opts.doKick      ? 1 : 0) }
    if (opts.doMute      !== undefined) { sets.push('do_mute=?');       vals.push(opts.doMute      ? 1 : 0) }
    if (opts.muteDuration!== undefined) { sets.push('mute_duration=?'); vals.push(Number(opts.muteDuration)) }
    if (!sets.length) return false
    this._db.run(`UPDATE qr_keywords SET ${sets.join(',')} WHERE group_id=? AND keyword=?`, [...vals, groupId, keyword])
    const changed = this._db.getRowsModified() > 0; this._save(); return changed
  }

  setQRKeywordRecallOnly(groupId, keyword, recallOnly) { return this.updateQRKeyword(groupId, keyword, { recallOnly }) }

  listCategoryQRKeywords(categoryId) {
    return this._all('SELECT * FROM category_qr_keywords WHERE category_id=? ORDER BY created_at', [categoryId])
  }

  addCategoryQRKeyword(categoryId, keyword, createdBy = null, opts = {}) {
    const { doRecall = 1, recallOnly = 0, doKick = 0, doMute = 0, muteDuration = 600 } =
      typeof opts === 'number' ? { recallOnly: opts } : opts
    try { this._run('INSERT INTO category_qr_keywords (category_id, keyword, do_recall, recall_only, do_kick, do_mute, mute_duration, created_by) VALUES (?,?,?,?,?,?,?,?)', [categoryId, keyword, doRecall ? 1 : 0, recallOnly ? 1 : 0, doKick ? 1 : 0, doMute ? 1 : 0, muteDuration, createdBy]); return true }
    catch { return false }
  }

  removeCategoryQRKeyword(categoryId, keyword) {
    this._db.run('DELETE FROM category_qr_keywords WHERE category_id=? AND keyword=?', [categoryId, keyword])
    const changed = this._db.getRowsModified() > 0; this._save(); return changed
  }

  updateCategoryQRKeyword(categoryId, keyword, opts = {}) {
    const sets = []; const vals = []
    if (opts.doRecall    !== undefined) { sets.push('do_recall=?');     vals.push(opts.doRecall    ? 1 : 0) }
    if (opts.recallOnly  !== undefined) { sets.push('recall_only=?');   vals.push(opts.recallOnly  ? 1 : 0) }
    if (opts.doKick      !== undefined) { sets.push('do_kick=?');       vals.push(opts.doKick      ? 1 : 0) }
    if (opts.doMute      !== undefined) { sets.push('do_mute=?');       vals.push(opts.doMute      ? 1 : 0) }
    if (opts.muteDuration!== undefined) { sets.push('mute_duration=?'); vals.push(Number(opts.muteDuration)) }
    if (!sets.length) return false
    this._db.run(`UPDATE category_qr_keywords SET ${sets.join(',')} WHERE category_id=? AND keyword=?`, [...vals, categoryId, keyword])
    const changed = this._db.getRowsModified() > 0; this._save(); return changed
  }

  setCategoryQRKeywordRecallOnly(categoryId, keyword, recallOnly) { return this.updateCategoryQRKeyword(categoryId, keyword, { recallOnly }) }

  // ── Admins ──────────────────────────────────────────────────────────────

  listAdmins(groupId = null) {
    if (groupId !== null) {
      return this._all(
        "SELECT * FROM admins WHERE group_id = ? OR role='root' ORDER BY role, user_id",
        [groupId]
      )
    }
    return this._all('SELECT * FROM admins ORDER BY role, group_id, user_id')
  }

  addAdmin(groupId, userId, role = 'admin') {
    this._run(`
      INSERT INTO admins (group_id, user_id, role) VALUES (?, ?, ?)
      ON CONFLICT(group_id, user_id) DO UPDATE SET role=excluded.role
    `, [groupId, userId, role])
    return true
  }

  removeAdmin(groupId, userId) {
    this._db.run('DELETE FROM admins WHERE group_id = ? AND user_id = ?', [groupId, userId])
    const changed = this._db.getRowsModified() > 0
    this._save()
    return changed
  }

  isRoot(userId) {
    return !!this._get("SELECT 1 FROM admins WHERE user_id=? AND role='root'", [userId])
  }

  isAdmin(groupId, userId) {
    return !!this._get(
      "SELECT 1 FROM admins WHERE user_id=? AND (role='root' OR (role='admin' AND group_id=?))",
      [userId, groupId]
    )
  }

  // ── Exempt Users ────────────────────────────────────────────────────────

  listExempt(groupId) {
    return this._all('SELECT * FROM exempt_users WHERE group_id=? ORDER BY user_id', [groupId])
  }

  addExempt(groupId, userId) {
    try { this._run('INSERT INTO exempt_users (group_id, user_id) VALUES (?, ?)', [groupId, userId]); return true }
    catch { return false }
  }

  removeExempt(groupId, userId) {
    this._db.run('DELETE FROM exempt_users WHERE group_id=? AND user_id=?', [groupId, userId])
    const changed = this._db.getRowsModified() > 0
    this._save()
    return changed
  }

  isExempt(groupId, userId) {
    if (this._get('SELECT 1 FROM exempt_users WHERE user_id=? AND (group_id=0 OR group_id=?)', [userId, groupId])) return true
    return !!this._get(`
      SELECT 1 FROM category_exempt_users ce
      JOIN group_category gc ON gc.category_id = ce.category_id
      WHERE ce.user_id = ? AND gc.group_id = ?
    `, [userId, groupId])
  }

  listCategoryExempt(categoryId) {
    return this._all('SELECT * FROM category_exempt_users WHERE category_id=? ORDER BY user_id', [categoryId])
  }

  addCategoryExempt(categoryId, userId) {
    try { this._run('INSERT INTO category_exempt_users (category_id, user_id) VALUES (?, ?)', [categoryId, userId]); return true }
    catch { return false }
  }

  removeCategoryExempt(categoryId, userId) {
    this._db.run('DELETE FROM category_exempt_users WHERE category_id=? AND user_id=?', [categoryId, userId])
    const changed = this._db.getRowsModified() > 0
    this._save()
    return changed
  }

  // ── Violations ──────────────────────────────────────────────────────────

  listViolations(groupId = null) {
    if (groupId !== null) return this._all('SELECT * FROM violations WHERE group_id=? ORDER BY count DESC', [groupId])
    return this._all('SELECT * FROM violations ORDER BY count DESC')
  }

  getViolation(userId, groupId) {
    return this._get('SELECT count FROM violations WHERE user_id=? AND group_id=?', [userId, groupId])?.count || 0
  }

  incrementViolation(userId, groupId, content = '', keyword = '') {
    this._db.run(`
      INSERT INTO violations (user_id, group_id, count, last_content) VALUES (?, ?, 1, ?)
      ON CONFLICT(user_id, group_id) DO UPDATE SET
        count=count+1, last_at=datetime('now','localtime'), last_content=excluded.last_content
    `, [userId, groupId, content])
    this._db.run(
      'INSERT INTO violation_logs (user_id, group_id, keyword, content) VALUES (?, ?, ?, ?)',
      [userId, groupId, keyword || '', content || '']
    )
    this._save()
    return this.getViolation(userId, groupId)
  }

  /** 归档违规（被踢出时调用）：保留记录，重置当前计数，标记归档时间 */
  archiveViolation(userId, groupId) {
    this._db.run(
      `UPDATE violations SET count=0, archived_at=datetime('now','localtime') WHERE user_id=? AND group_id=?`,
      [userId, groupId]
    )
    this._save()
  }

  /** 管理员手动清除：重置计数但不标记归档，violation_logs 永久保留 */
  clearViolation(userId, groupId = null) {
    if (groupId !== null) {
      this._db.run('DELETE FROM violations WHERE user_id=? AND group_id=?', [userId, groupId])
    } else {
      this._db.run('DELETE FROM violations WHERE user_id=?', [userId])
    }
    this._save()
  }

  /** 查询用户在指定群的每次触发详情 */
  listViolationLogs(userId, groupId = null) {
    if (groupId !== null) {
      return this._all(
        'SELECT * FROM violation_logs WHERE user_id=? AND group_id=? ORDER BY triggered_at',
        [userId, groupId]
      )
    }
    return this._all('SELECT * FROM violation_logs WHERE user_id=? ORDER BY triggered_at', [userId])
  }

  /**
   * 查询用户在 joinedGroupId 及其同组群的全部历史违规。
   * 用于成员重新入群时生成提醒摘要。
   */
  getRelevantViolationHistory(userId, joinedGroupId) {
    const catIds = this.getGroupCategoryIds(joinedGroupId)
    const relatedGroupIds = new Set([joinedGroupId])
    for (const catId of catIds) {
      for (const g of this.getCategoryGroups(catId)) relatedGroupIds.add(g.group_id)
    }
    const ids = [...relatedGroupIds]
    const ph = ids.map(() => '?').join(',')
    const logs = this._all(
      `SELECT * FROM violation_logs WHERE user_id=? AND group_id IN (${ph}) ORDER BY triggered_at`,
      [userId, ...ids]
    )
    const groups = this._all(
      `SELECT user_id, group_id, count, last_content, last_at, archived_at FROM violations
       WHERE user_id=? AND group_id IN (${ph})`,
      [userId, ...ids]
    )
    return { total: logs.length, groups, logs }
  }

  // ── Users ───────────────────────────────────────────────────────────────

  listUsers() {
    return this._all('SELECT id, username, role, created_at FROM users ORDER BY id')
  }

  getUser(username) {
    return this._get('SELECT * FROM users WHERE username=?', [username]) || null
  }

  addUser(username, hashedPassword, role = 'admin') {
    try { this._run('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashedPassword, role]); return true }
    catch { return false }
  }

  removeUser(username) {
    this._db.run('DELETE FROM user_groups WHERE username=?', [username])
    this._db.run('DELETE FROM user_categories WHERE username=?', [username])
    this._db.run('DELETE FROM users WHERE username=?', [username])
    const changed = this._db.getRowsModified() > 0
    this._save()
    return changed
  }

  // ── User → Group authorization ───────────────────────────────────────────

  /** 直接授权的群 ID 列表 */
  getUserDirectGroups(username) {
    return this._all('SELECT group_id FROM user_groups WHERE username=? ORDER BY group_id', [username])
      .map(r => r.group_id)
  }

  /** 所有可访问群（直接 ∪ 经由组别） */
  getUserGroups(username) {
    const direct = this.getUserDirectGroups(username)
    const viaCat = this._all(`
      SELECT DISTINCT gc.group_id FROM group_category gc
      JOIN user_categories uc ON uc.category_id = gc.category_id
      WHERE uc.username = ?
    `, [username]).map(r => r.group_id)
    return [...new Set([...direct, ...viaCat])].sort((a, b) => a - b)
  }

  addUserGroup(username, groupId) {
    try { this._run('INSERT OR IGNORE INTO user_groups (username, group_id) VALUES (?, ?)', [username, groupId]); return true }
    catch { return false }
  }

  removeUserGroup(username, groupId) {
    this._db.run('DELETE FROM user_groups WHERE username=? AND group_id=?', [username, groupId])
    const changed = this._db.getRowsModified() > 0
    this._save()
    return changed
  }

  hasGroupAccess(username, groupId) {
    if (this._get('SELECT 1 FROM user_groups WHERE username=? AND group_id=?', [username, groupId])) return true
    return !!this._get(`
      SELECT 1 FROM user_categories uc
      JOIN group_category gc ON gc.category_id = uc.category_id
      WHERE uc.username = ? AND gc.group_id = ?
    `, [username, groupId])
  }

  // ── Categories ───────────────────────────────────────────────────────────

  listCategories() {
    return this._all(`
      SELECT c.*,
        (SELECT COUNT(*) FROM group_category    WHERE category_id = c.id) AS group_count,
        (SELECT COUNT(*) FROM category_keywords WHERE category_id = c.id) AS keyword_count
      FROM categories c ORDER BY c.name
    `)
  }

  getCategory(id) {
    return this._get('SELECT * FROM categories WHERE id=?', [id]) || null
  }

  addCategory(name) {
    try { this._run('INSERT INTO categories (name) VALUES (?)', [name]); return true }
    catch { return false }
  }

  removeCategory(id) {
    this._db.run('DELETE FROM group_category WHERE category_id=?', [id])
    this._db.run('DELETE FROM category_keywords WHERE category_id=?', [id])
    this._db.run('DELETE FROM category_exempt_users WHERE category_id=?', [id])
    this._db.run('DELETE FROM user_categories WHERE category_id=?', [id])
    this._db.run('DELETE FROM categories WHERE id=?', [id])
    const changed = this._db.getRowsModified() > 0
    this._save()
    return changed
  }

  getCategoryGroups(categoryId) {
    return this._all(`
      SELECT g.* FROM groups g
      JOIN group_category gc ON gc.group_id = g.group_id
      WHERE gc.category_id = ? ORDER BY g.group_id
    `, [categoryId])
  }

  addGroupToCategory(groupId, categoryId) {
    try { this._run('INSERT OR IGNORE INTO group_category (group_id, category_id) VALUES (?, ?)', [groupId, categoryId]); return true }
    catch { return false }
  }

  removeGroupFromCategory(groupId, categoryId) {
    this._db.run('DELETE FROM group_category WHERE group_id=? AND category_id=?', [groupId, categoryId])
    const changed = this._db.getRowsModified() > 0
    this._save()
    return changed
  }

  // ── Category keywords ────────────────────────────────────────────────────

  listCategoryKeywords(categoryId) {
    return this._all(
      'SELECT * FROM category_keywords WHERE category_id=? ORDER BY created_at',
      [categoryId]
    )
  }

  addCategoryKeyword(categoryId, keyword, createdBy = null, opts = {}) {
    const { doRecall = 1, recallOnly = 0, doKick = 0, doMute = 0, muteDuration = 600 } =
      typeof opts === 'number' ? { recallOnly: opts } : opts
    try {
      this._run(
        'INSERT INTO category_keywords (category_id, keyword, do_recall, recall_only, do_kick, do_mute, mute_duration, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [categoryId, keyword, doRecall ? 1 : 0, recallOnly ? 1 : 0, doKick ? 1 : 0, doMute ? 1 : 0, Number(muteDuration), createdBy]
      )
      return true
    } catch { return false }
  }

  removeCategoryKeyword(categoryId, keyword) {
    this._db.run('DELETE FROM category_keywords WHERE category_id=? AND keyword=?', [categoryId, keyword])
    const changed = this._db.getRowsModified() > 0
    this._save()
    return changed
  }

  updateCategoryKeyword(categoryId, keyword, opts = {}) {
    const sets = []; const vals = []
    if (opts.doRecall    !== undefined) { sets.push('do_recall=?');     vals.push(opts.doRecall    ? 1 : 0) }
    if (opts.recallOnly  !== undefined) { sets.push('recall_only=?');   vals.push(opts.recallOnly  ? 1 : 0) }
    if (opts.doKick      !== undefined) { sets.push('do_kick=?');       vals.push(opts.doKick      ? 1 : 0) }
    if (opts.doMute      !== undefined) { sets.push('do_mute=?');       vals.push(opts.doMute      ? 1 : 0) }
    if (opts.muteDuration!== undefined) { sets.push('mute_duration=?'); vals.push(Number(opts.muteDuration)) }
    if (!sets.length) return false
    this._db.run(`UPDATE category_keywords SET ${sets.join(',')} WHERE category_id=? AND keyword=?`, [...vals, categoryId, keyword])
    const changed = this._db.getRowsModified() > 0; this._save(); return changed
  }

  setCategoryKeywordRecallOnly(categoryId, keyword, recallOnly) { return this.updateCategoryKeyword(categoryId, keyword, { recallOnly }) }

  // ── User → Category authorization ────────────────────────────────────────

  getUserCategories(username) {
    return this._all(`
      SELECT c.id, c.name FROM categories c
      JOIN user_categories uc ON uc.category_id = c.id
      WHERE uc.username = ? ORDER BY c.name
    `, [username])
  }

  getUserCategoryIds(username) {
    return this._all('SELECT category_id FROM user_categories WHERE username=? ORDER BY category_id', [username])
      .map(r => r.category_id)
  }

  addUserCategory(username, categoryId) {
    try { this._run('INSERT OR IGNORE INTO user_categories (username, category_id) VALUES (?, ?)', [username, categoryId]); return true }
    catch { return false }
  }

  removeUserCategory(username, categoryId) {
    this._db.run('DELETE FROM user_categories WHERE username=? AND category_id=?', [username, categoryId])
    const changed = this._db.getRowsModified() > 0
    this._save()
    return changed
  }

  hasCategoryAccess(username, categoryId) {
    return !!this._get('SELECT 1 FROM user_categories WHERE username=? AND category_id=?', [username, categoryId])
  }

  updatePassword(username, hashedPassword) {
    this._db.run('UPDATE users SET password=? WHERE username=?', [hashedPassword, username])
    const changed = this._db.getRowsModified() > 0
    this._save()
    return changed
  }

  updateUsername(oldUsername, newUsername) {
    try {
      this._db.run('UPDATE users SET username=? WHERE username=?', [newUsername, oldUsername])
      if (this._db.getRowsModified() === 0) return false
      this._db.run('UPDATE user_groups SET username=? WHERE username=?', [newUsername, oldUsername])
      this._db.run('UPDATE user_categories SET username=? WHERE username=?', [newUsername, oldUsername])
      this._save()
      return true
    } catch { return false }
  }

  userCount() {
    return this._get('SELECT COUNT(*) as n FROM users')?.n || 0
  }

  // ── Image rules ──────────────────────────────────────────────────────────

  // Returns merged rules for a group: global ← category (if group in category) ← per-group.
  // API keys (ocr_key, nsfw_key, llm_key, llm_url, etc.) always come from global row.
  getImageRules(groupId) {
    const global = this._get('SELECT * FROM image_rules WHERE group_id=0') || {}
    if (!groupId) return global
    // Prefer category-level overrides for groups that belong to a category
    const catRow = this._get(`
      SELECT cir.* FROM category_image_rules cir
      JOIN group_category gc ON gc.category_id = cir.category_id
      WHERE gc.group_id = ? LIMIT 1
    `, [groupId])
    const row = catRow || this._get('SELECT * FROM image_rules WHERE group_id=?', [groupId]) || {}
    return {
      ...global,
      qr_enabled:     row.qr_enabled     ?? global.qr_enabled     ?? 0,
      qr_block_all:   row.qr_block_all   ?? global.qr_block_all   ?? 0,
      ocr_enabled:    row.ocr_enabled     ?? global.ocr_enabled    ?? 0,
      ocr_langs:      row.ocr_langs       || global.ocr_langs      || 'chi_sim+eng',
      ocr_url:        row.ocr_url         || global.ocr_url        || '',
      nsfw_enabled:   row.nsfw_enabled    ?? global.nsfw_enabled   ?? 0,
      nsfw_threshold: row.nsfw_threshold  ?? global.nsfw_threshold ?? 0.7,
      llm_enabled:    row.llm_enabled     ?? global.llm_enabled    ?? 0,
    }
  }

  getImageRulesRaw(groupId) {
    return this._get('SELECT * FROM image_rules WHERE group_id=?', [groupId]) || null
  }

  getCategoryImageRulesRaw(categoryId) {
    return this._get('SELECT * FROM category_image_rules WHERE category_id=?', [categoryId]) || null
  }

  isGroupInCategory(groupId) {
    return !!this._get(
      'SELECT 1 FROM group_category gc JOIN categories c ON c.id = gc.category_id WHERE gc.group_id=?',
      [groupId]
    )
  }

  getGroupCategoryIds(groupId) {
    // JOIN categories 以过滤孤立 group_category 行（其 category 已被删除），
    // 与 listGroups / isGroupInCategory 保持一致，避免向已删除组别派生踢/禁群
    return this._all(
      'SELECT gc.category_id FROM group_category gc JOIN categories c ON c.id = gc.category_id WHERE gc.group_id=?',
      [groupId]
    ).map(r => r.category_id)
  }

  setImageRules(groupId, fields) {
    const COLS = ['qr_enabled','qr_block_all','ocr_enabled','ocr_langs','ocr_url',
                  'nsfw_enabled','nsfw_url','nsfw_key','nsfw_threshold',
                  'llm_enabled','llm_url','llm_key','llm_model','llm_prompt']
    const existing = this._get('SELECT * FROM image_rules WHERE group_id=?', [groupId]) || {}
    const merged = { ...existing, ...fields, group_id: groupId }
    this._run(
      `INSERT OR REPLACE INTO image_rules (group_id,${COLS.join(',')},updated_at) VALUES (?,${COLS.map(()=>'?').join(',')},datetime('now','localtime'))`,
      [groupId, ...COLS.map(c => merged[c] ?? null)]
    )
    this._save()
  }

  setCategoryImageRules(categoryId, fields) {
    const COLS = ['qr_enabled','qr_block_all','ocr_enabled','ocr_langs','ocr_url',
                  'nsfw_enabled','nsfw_threshold','llm_enabled']
    const existing = this._get('SELECT * FROM category_image_rules WHERE category_id=?', [categoryId]) || {}
    const merged = { ...existing, ...fields, category_id: categoryId }
    this._run(
      `INSERT OR REPLACE INTO category_image_rules (category_id,${COLS.join(',')},updated_at) VALUES (?,${COLS.map(()=>'?').join(',')},datetime('now','localtime'))`,
      [categoryId, ...COLS.map(c => merged[c] ?? null)]
    )
  }

  // ── Global settings ──────────────────────────────────────────────────

  getSetting(key) {
    return this._get('SELECT value FROM settings WHERE key=?', [key])?.value ?? null
  }

  setSetting(key, value) {
    if (value === null || value === undefined || value === '') {
      this._db.run('DELETE FROM settings WHERE key=?', [key])
    } else {
      this._db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)])
    }
    this._save()
  }

  // ── Migration from legacy config ─────────────────────────────────────

  migrateFromConfig(cfg) {
    const n = this._get('SELECT COUNT(*) as n FROM keywords')?.n || 0
    if (n > 0) return

    let count = 0
    for (const kw  of cfg.get('recallKeywords', [])) if (this.addKeyword(0, kw)) count++
    for (const gid of cfg.get('whitelistGroups', [])) this.upsertGroup(gid)
    for (const uid of cfg.get('rootUsers', []))        this.addAdmin(0, uid, 'root')
    for (const uid of cfg.get('exemptUsers', []))      this.addExempt(0, uid)

    if (count > 0) console.log(`[DB] 迁移完成: ${count} 条关键词，${cfg.get('whitelistGroups', []).length} 个群组`)
  }
}
