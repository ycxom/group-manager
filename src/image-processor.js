/**
 * 图片内容分析：QR 码提取 / OCR / NSFW 检测 / LLM 分析
 *
 * QR 码：jimp（纯 JS 图像解码）+ jsqr（纯 JS 二维码识别），无需外部 API
 * OCR：tesseract.js 本地识别，按语言缓存 Worker，无需外部 API
 * NSFW / LLM：通过可配置的外部 HTTP API，格式见下方注释
 */

import { createWorker } from 'tesseract.js'

// Worker 按语言键缓存，避免重复初始化
const _ocrWorkers = Object.create(null)

function _getOCRWorker(langs) {
  const key = langs || 'chi_sim+eng'
  if (!_ocrWorkers[key]) {
    _ocrWorkers[key] = createWorker(key, 1, { logger: () => {} })
  }
  return _ocrWorkers[key]
}

const IMG_FETCH_TIMEOUT = 10_000

async function fetchImage(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), IMG_FETCH_TIMEOUT)
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://qq.com' }
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return Buffer.from(await resp.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

// ── QR 码 ────────────────────────────────────────────────────────────────────
async function extractQR(imageUrl) {
  try {
    const buf = await fetchImage(imageUrl)
    const { Jimp } = await import('jimp')
    const img = await Jimp.read(buf)
    const { data, width, height } = img.bitmap
    const { default: jsQR } = await import('jsqr')
    const code = jsQR(new Uint8ClampedArray(data), width, height)
    return code ? code.data : null
  } catch (e) {
    if (e.name !== 'AbortError') console.error('[ImageProc] QR 识别失败:', e.message)
    return null
  }
}

// ── OCR（tesseract.js 本地识别）───────────────────────────────────────────────
async function ocrLocal(imageUrl, langs) {
  try {
    const buf = await fetchImage(imageUrl)
    const worker = await _getOCRWorker(langs)
    const { data: { text } } = await worker.recognize(buf)
    return text.trim() || null
  } catch (e) {
    console.error('[ImageProc] OCR 失败:', e.message)
    return null
  }
}

// ── NSFW 检测（外部 API）─────────────────────────────────────────────────────
// 接口格式：POST { url } → { score: 0.0~1.0 }  或  { nsfw: true }
async function checkNSFW(imageUrl, apiUrl, apiKey, threshold) {
  if (!apiUrl) return false
  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ url: imageUrl }),
      signal: AbortSignal.timeout(15_000)
    })
    const data = await resp.json()
    if (typeof data.nsfw === 'boolean') return data.nsfw
    const score = Number(data.score ?? data.confidence ?? data.probability ?? 0)
    return score >= (threshold ?? 0.7)
  } catch (e) {
    console.error('[ImageProc] NSFW 检测失败:', e.message)
    return false
  }
}

// ── LLM 分析（OpenAI 兼容接口）───────────────────────────────────────────────
// 支持任意 OpenAI-compatible 视觉模型（GPT-4o / Qwen-VL / Claude 等）
// 回复格式约定：正常内容返回 "OK"，违规内容返回 "VIOLATION: 原因"
const DEFAULT_LLM_PROMPT = '请审查这张图片是否包含违规内容（如色情、暴力、赌博、违禁品广告等）。只需回复 OK（无违规）或 VIOLATION: <原因>（有违规），不要额外说明。'

async function callLLM(imageUrl, apiUrl, apiKey, model, prompt) {
  if (!apiUrl) return null
  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey || ''}` },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt || DEFAULT_LLM_PROMPT },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }],
        max_tokens: 100
      }),
      signal: AbortSignal.timeout(30_000)
    })
    const data = await resp.json()
    return data.choices?.[0]?.message?.content?.trim() || null
  } catch (e) {
    console.error('[ImageProc] LLM 分析失败:', e.message)
    return null
  }
}

// ── 主入口 ────────────────────────────────────────────────────────────────────
/**
 * @param {string} imageUrl
 * @param {{ qr_enabled, qr_block_all, ocr_enabled, ocr_langs,
 *            nsfw_enabled, nsfw_url, nsfw_key, nsfw_threshold,
 *            llm_enabled, llm_url, llm_key, llm_model, llm_prompt }} rules
 * @returns {{ qr:string|null, ocr:string|null, nsfw:boolean, llm:string|null }}
 */
export async function analyzeImage(imageUrl, rules) {
  const out = { qr: null, ocr: null, nsfw: false, llm: null }
  if (!imageUrl || !rules) return out

  const tasks = []
  if (rules.qr_enabled || rules.qr_block_all) {
    tasks.push(extractQR(imageUrl).then(v => { out.qr = v }))
  }
  if (rules.ocr_enabled) {
    tasks.push(ocrLocal(imageUrl, rules.ocr_langs).then(v => { out.ocr = v }))
  }
  if (rules.nsfw_enabled && rules.nsfw_url) {
    tasks.push(checkNSFW(imageUrl, rules.nsfw_url, rules.nsfw_key, rules.nsfw_threshold).then(v => { out.nsfw = v }))
  }
  if (rules.llm_enabled && rules.llm_url) {
    tasks.push(callLLM(imageUrl, rules.llm_url, rules.llm_key, rules.llm_model, rules.llm_prompt).then(v => { out.llm = v }))
  }

  await Promise.allSettled(tasks)
  return out
}
