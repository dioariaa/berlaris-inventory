FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render (dan PaaS lain) inject $PORT — fallback 8000 untuk lokal/Docker manual
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
