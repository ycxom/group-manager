# CPU 版（无需 GPU/CUDA，适合任何机器）
FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        libglib2.0-0 libsm6 libxrender1 libxext6 libgl1 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    paddlepaddle==2.6.2 \
    "paddleocr>=2.8.0" \
    fastapi==0.115.0 \
    "uvicorn[standard]==0.30.6" \
    httpx==0.27.0

WORKDIR /app
COPY server.py .

EXPOSE 8866
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8866"]
