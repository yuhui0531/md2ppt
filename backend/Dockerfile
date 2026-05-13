FROM harbor-chengdu.seeyoncloud.com/zw/python:3.11.14-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    TZ=Asia/Shanghai

# slim 基础镜像不带 tzdata；不装的话 TZ env 不生效，日志只会是 UTC
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir "uv>=0.5,<1.0"

# 先装依赖（命中缓存）
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# 再拷贝应用代码
COPY app ./app

# 确保 storage 目录存在（compose 会挂卷覆盖）
RUN mkdir -p /app/app/storage/uploads /app/app/storage/exports

EXPOSE 8008

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8008"]
