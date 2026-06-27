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
const IMG_FETCH_RETRIES = 2   // 总尝试次数 = 1 + 重试，应对 QQ CDN 偶发失败/超时

async function _fetchOnce(url) {
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

async function fetchImage(url) {
  let lastErr
  for (let i = 0; i <= IMG_FETCH_RETRIES; i++) {
    try {
      return await _fetchOnce(url)
    } catch (e) {
      lastErr = e
      if (i < IMG_FETCH_RETRIES) await new Promise(r => setTimeout(r, 300 * (i + 1)))
    }
  }
  throw lastErr
}

// ── QR 码 ────────────────────────────────────────────────────────────────────
// jsQR 单次扫描对图片尺寸敏感：过大的图找不到定位图案、过小的图分辨率不足，
// 同类二维码会出现"有时识别、有时不识别"。这里按多种尺度 + 灰度预处理多次尝试，
// 命中即返回，显著提升识别率。
function _jsqrScan(jsQR, img) {
  const { data, width, height } = img.bitmap
  const code = jsQR(new Uint8ClampedArray(data), width, height, { inversionAttempts: 'attemptBoth' })
  return code?.data || null
}

async function extractQR(buf) {
  try {
    const jimpMod = await import('jimp')
    const Jimp = jimpMod.Jimp ?? jimpMod.default
    const { default: jsQR } = await import('jsqr')
    const base = await Jimp.read(buf)
    const maxDim = Math.max(base.bitmap.width, base.bitmap.height)

    // 候选尺度：原图 → 缩小（大图）/ 放大（小图），按命中概率排序，命中即停
    const scales = [1]
    if (maxDim > 1280) scales.push(1280 / maxDim)        // 大图缩小到 ~1280px
    if (maxDim > 2400) scales.push(900 / maxDim)         // 超大图再缩一档
    if (maxDim < 360)  scales.push(2)                    // 小图放大

    for (const s of scales) {
      const img = s === 1 ? base : base.clone().scale(s)
      const hit = _jsqrScan(jsQR, img)
      if (hit) return hit
    }
    // 仍未命中：灰度 + 提升对比度再试原图（应对低对比/彩色二维码）
    const prep = base.clone().greyscale().contrast(0.3)
    return _jsqrScan(jsQR, prep)
  } catch (e) {
    console.error('[ImageProc] QR 识别失败:', e.message)
    return null
  }
}

// ── OCR（tesseract.js 本地识别）───────────────────────────────────────────────
async function ocrLocal(buf, langs) {
  try {
    const worker = await _getOCRWorker(langs)
    const { data: { text } } = await worker.recognize(buf)
    return text.trim() || null
  } catch (e) {
    console.error('[ImageProc] OCR 失败:', e.message)
    return null
  }
}

// ── PaddleOCR HTTP 服务（可选，中文准确率远高于 tesseract）───────────────────
async function ocrPaddle(buf, apiUrl) {
  try {
    const resp = await fetch(`${apiUrl}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b64: buf.toString('base64') }),
      signal: AbortSignal.timeout(30_000)
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    return data.text?.trim() || null
  } catch (e) {
    console.error('[ImageProc] PaddleOCR 调用失败:', e.message)
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

  // QR 和 OCR 都需要原始图片 buffer，共享一次下载避免重复请求
  const needsBuf = (rules.qr_enabled || rules.qr_block_all) || rules.ocr_enabled
  if (needsBuf) {
    const bufP = fetchImage(imageUrl)
    if (rules.qr_enabled || rules.qr_block_all) {
      tasks.push(bufP.then(buf => extractQR(buf)).then(v => { out.qr = v }).catch(e => { console.error('[ImageProc] QR 识别失败:', e.message) }))
    }
    if (rules.ocr_enabled) {
      if (rules.ocr_url) {
        tasks.push(bufP.then(buf => ocrPaddle(buf, rules.ocr_url)).then(v => { out.ocr = v }).catch(e => { console.error('[ImageProc] PaddleOCR 失败:', e.message) }))
      } else {
        tasks.push(bufP.then(buf => ocrLocal(buf, rules.ocr_langs)).then(v => { out.ocr = v }).catch(e => { console.error('[ImageProc] OCR 失败:', e.message) }))
      }
    }
  }

  // NSFW 和 LLM 是外部 API，直接用 URL，与本地任务并行
  if (rules.nsfw_enabled && rules.nsfw_url) {
    tasks.push(checkNSFW(imageUrl, rules.nsfw_url, rules.nsfw_key, rules.nsfw_threshold).then(v => { out.nsfw = v }))
  }
  if (rules.llm_enabled && rules.llm_url) {
    tasks.push(callLLM(imageUrl, rules.llm_url, rules.llm_key, rules.llm_model, rules.llm_prompt).then(v => { out.llm = v }))
  }

  await Promise.allSettled(tasks)
  return out
}
