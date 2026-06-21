import os, base64, tempfile, math, httpx

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from rapidocr_onnxruntime import RapidOCR

app = FastAPI()

MIN_CONF = float(os.getenv('OCR_MIN_CONF', '0.7'))
MIN_LEN  = int(os.getenv('OCR_MIN_LEN', '2'))

def _is_garbage(text: str) -> bool:
    t = text.replace(' ', '')
    if len(t) < 4:
        return False
    freq = {}
    for c in t:
        freq[c] = freq.get(c, 0) + 1
    entropy = -sum((v / len(t)) * math.log2(v / len(t)) for v in freq.values())
    max_entropy = math.log2(len(t))
    return (entropy / max_entropy) > 0.85 if max_entropy > 0 else False

print('[OCR] 初始化 RapidOCR...')
_ocr = RapidOCR()
print('[OCR] 准备就绪')

class OcrReq(BaseModel):
    url: str | None = None
    b64: str | None = None

@app.post('/ocr')
async def ocr(req: OcrReq):
    if req.b64:
        try:
            data = base64.b64decode(req.b64)
        except Exception:
            raise HTTPException(400, '无效的 base64')
    elif req.url:
        try:
            async with httpx.AsyncClient(timeout=15) as c:
                r = await c.get(req.url, headers={
                    'User-Agent': 'Mozilla/5.0',
                    'Referer': 'https://qq.com'
                })
                r.raise_for_status()
                data = r.content
        except Exception as e:
            raise HTTPException(400, f'图片下载失败: {e}')
    else:
        raise HTTPException(400, '缺少 url 或 b64')

    with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f:
        f.write(data)
        tmp = f.name

    try:
        result, _ = _ocr(tmp)
        lines = []
        for item in (result or []):
            # RapidOCR 格式: [box, text, confidence]
            if len(item) >= 3:
                text, conf = str(item[1]), float(item[2])
                if conf >= MIN_CONF and len(text) >= MIN_LEN and not _is_garbage(text):
                    lines.append(text)
        return {'text': '\n'.join(lines)}
    except Exception as e:
        import traceback
        print(f'[OCR] 异常:\n{traceback.format_exc()}')
        raise HTTPException(500, f'OCR 处理失败: {e}')
    finally:
        os.unlink(tmp)

@app.get('/health')
def health():
    return {'ok': True}
