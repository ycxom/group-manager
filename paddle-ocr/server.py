import os, base64, tempfile, httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from paddleocr import PaddleOCR

app = FastAPI()

USE_GPU = os.getenv('USE_GPU', '0') == '1'
LANG    = os.getenv('OCR_LANG', 'ch')   # ch=简体中文, japan=日文, en=英文

print(f'[PaddleOCR] 初始化 lang={LANG} use_gpu={USE_GPU}')
_ocr = PaddleOCR(use_angle_cls=True, lang=LANG, use_gpu=USE_GPU)
print('[PaddleOCR] 准备就绪')

class OcrReq(BaseModel):
    url: str | None = None
    b64: str | None = None  # base64 编码的图片数据

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
        result = _ocr.ocr(tmp, cls=True)
        lines = []
        for page in (result or []):
            for line in (page or []):
                if line and len(line) >= 2:
                    text, conf = line[1]
                    if conf >= 0.5:
                        lines.append(text)
        return {'text': '\n'.join(lines)}
    except Exception as e:
        raise HTTPException(500, f'OCR 处理失败: {e}')
    finally:
        os.unlink(tmp)

@app.get('/health')
def health():
    return {'ok': True}
