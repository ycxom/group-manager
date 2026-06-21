import os, base64, tempfile, httpx

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from rapidocr_onnxruntime import RapidOCR

app = FastAPI()

MIN_CONF = float(os.getenv('OCR_MIN_CONF', '0.6'))
MIN_LEN  = int(os.getenv('OCR_MIN_LEN', '1'))

def _is_garbage(text: str) -> bool:
    """乱码检测：有意义字符（中日韩 / 字母 / 数字）占比过低 → 判为乱码。
    不对中文做"字符重复"假设——中文短语本就每字不同。"""
    t = text.replace(' ', '')
    if len(t) < 4:
        return False
    meaningful = sum(
        1 for c in t
        if c.isalnum() or '一' <= c <= '鿿'
        or '぀' <= c <= 'ヿ'      # 日文假名
        or '가' <= c <= '힣'      # 韩文
    )
    return (meaningful / len(t)) < 0.5

USE_GPU = os.getenv('USE_GPU', '0') == '1'

def _make_ocr():
    """GPU 时尝试启用 CUDA EP；不同 rapidocr 版本签名不同，逐个降级尝试。"""
    if USE_GPU:
        for kw in (
            {'params': {'Global.use_cuda': True}},                       # 1.3.x+
            {'det_use_cuda': True, 'cls_use_cuda': True, 'rec_use_cuda': True},  # 旧版
        ):
            try:
                print(f'[OCR] 尝试启用 GPU: {kw}')
                return RapidOCR(**kw)
            except TypeError:
                continue
        print('[OCR] 当前 rapidocr 版本不识别 GPU 参数，回退 CPU')
    return RapidOCR()

print(f'[OCR] 初始化 RapidOCR... (USE_GPU={USE_GPU})')
_ocr = _make_ocr()
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
