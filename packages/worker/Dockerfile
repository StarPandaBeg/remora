FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POETRY_VERSION=2.1.3 \
    POETRY_VIRTUALENVS_CREATE=false

WORKDIR /app

# System dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir "poetry==$POETRY_VERSION"

COPY pyproject.toml poetry.lock ./
RUN poetry install --only main --no-root --no-interaction

COPY src ./src
RUN poetry install --only-root --no-interaction

EXPOSE 8000

CMD ["uvicorn", "worker.main:app", "--host", "0.0.0.0", "--port", "8000"]