# Remora Worker

Python-сервис для выполнения отдельных задач, которые отправляет основное ядро
Remora. Worker принимает команду по HTTP, запускает соответствующий handler в
фоне и отправляет события о ходе выполнения на переданный `callbackUrl`.

Worker не использует PostgreSQL, не хранит состояние задач и не занимается
оркестрацией. Для чтения исходных файлов и записи результатов он использует
общий MinIO.

## Возможности

- асинхронный приём задач через FastAPI;
- фоновой запуск без удержания входящего HTTP-запроса;
- ограничение параллельных задач через `asyncio.Semaphore`;
- события `task.started`, `task.progress`, `task.completed` и `task.failed`;
- повторные попытки доставки финальных событий;
- файловые download/upload/delete операции с MinIO без загрузки больших файлов
  целиком в память;
- автоматическая очистка временных файлов;
- тестовые handlers `test` и `test.storage`.

## Требования

- Python 3.12 или новее;
- Poetry 2;
- доступный MinIO для handlers, работающих с файлами.

## Переменные окружения

Worker читает настройки из environment и, при наличии, из `.env` в текущей
рабочей директории.

| Переменная                     | Обязательна | Значение по умолчанию | Назначение                                                        |
| ------------------------------ | ----------- | --------------------- | ----------------------------------------------------------------- |
| `WORKER_SECRET`                | да          | —                     | Секрет, добавляемый во все callback-запросы как `x-worker-secret` |
| `MINIO_ACCESS_KEY`             | да          | —                     | Access key общего MinIO                                           |
| `MINIO_SECRET_KEY`             | да          | —                     | Secret key общего MinIO                                           |
| `MINIO_ENDPOINT`               | нет         | `127.0.0.1`           | Hostname или IP MinIO без схемы URL                               |
| `MINIO_PORT`                   | нет         | `9000`                | Порт MinIO API                                                    |
| `MINIO_USE_SSL`                | нет         | `false`               | Использовать HTTPS для подключения к MinIO                        |
| `MINIO_BUCKET`                 | нет         | `remora`              | Общий bucket для загружаемых результатов                          |
| `MINIO_REGION`                 | нет         | `us-east-1`           | Регион MinIO                                                      |
| `MAX_CONCURRENT_TASKS`         | нет         | `2`                   | Максимальное число одновременно выполняемых задач                 |
| `HTTP_TIMEOUT`                 | нет         | `10`                  | Timeout callback HTTP-запросов в секундах                         |
| `FINAL_EVENT_RETRY_COUNT`      | нет         | `3`                   | Число попыток доставки `task.completed` и `task.failed`           |
| `FINAL_EVENT_RETRY_BASE_DELAY` | нет         | `0.25`                | Начальная задержка exponential backoff в секундах                 |

`WORKER_SECRET` должен совпадать с секретом, который принимающая callback
сторона ожидает в заголовке `x-worker-secret`. Секреты не передаются в теле
событий и не логируются.

Пример локальной конфигурации:

```dotenv
WORKER_SECRET=replace-with-a-long-random-worker-secret

MINIO_ENDPOINT=127.0.0.1
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=remora
MINIO_SECRET_KEY=replace-with-a-minio-secret
MINIO_BUCKET=remora
MINIO_REGION=us-east-1

MAX_CONCURRENT_TASKS=2
HTTP_TIMEOUT=10
FINAL_EVENT_RETRY_COUNT=3
FINAL_EVENT_RETRY_BASE_DELAY=0.25
```

## Запуск в dev-режиме

Из корня репозитория:

```bash
cd packages/worker
poetry install
```

Если общие переменные находятся в корневом `.env`, загрузите их в shell:

```bash
set -a
source ../../.env
set +a
```

После этого запустите Uvicorn с hot reload:

```bash
poetry run uvicorn worker.main:app \
  --host 127.0.0.1 \
  --port 8000 \
  --reload \
  --reload-dir src
```

Также можно создать `packages/worker/.env`: при запуске из этой директории
worker прочитает его автоматически.

Проверка health endpoint:

```bash
curl http://127.0.0.1:8000/health
```

Ожидаемый ответ:

```json
{
    "status": "ok"
}
```

## Запуск через Docker Compose

Заполните корневой `.env`. Как минимум должны быть заданы `WORKER_SECRET` и
MinIO credentials:

```dotenv
WORKER_SECRET=replace-with-a-long-random-worker-secret
MINIO_ACCESS_KEY=remora
MINIO_SECRET_KEY=replace-with-a-minio-secret
```

Соберите и запустите worker вместе с MinIO:

```bash
docker compose up --build remora-worker
```

Compose автоматически запустит `remora-minio`, дождётся его healthcheck и
передаст worker-у hostname `remora-minio`. Снаружи worker доступен по адресу
`http://127.0.0.1:8000`.

Запуск в фоне:

```bash
docker compose up --build -d remora-worker
docker compose logs -f remora-worker
```

Остановка сервисов:

```bash
docker compose down
```

Команда `docker compose down` не удаляет MinIO volume. Для обычной остановки
не добавляйте флаг `--volumes`, если сохранённые объекты нужны дальше.

## HTTP API

### `GET /health`

Проверяет, что процесс worker-а запущен. Endpoint не выполняет запросов к MinIO
или PostgreSQL.

### `POST /tasks/execute`

Принимает задачу и сразу возвращает `202 Accepted`:

```json
{
    "pipeline": "video_summary",
    "type": "test",
    "taskId": 123,
    "callbackUrl": "http://127.0.0.1:3000/v1/tasks/events",
    "input": {},
    "config": {}
}
```

`pipeline` обозначает pipeline верхнего уровня и сохраняется как контекст
выполнения. `type` обозначает конкретную операцию и используется для выбора
handler-а. Например, несколько операций одного `video_summary` pipeline могут
иметь разные значения `type`. Текущий dispatch выполняется только по `type`.

Ответ:

```json
{
    "accepted": true
}
```

Результат выполнения возвращается не в этом response, а отдельным POST-запросом
на `callbackUrl`.

## Storage reference

Worker использует тот же стабильный формат ссылки на объект MinIO:

```json
{
    "bucket": "remora",
    "objectKey": "entries/files/example/original.mp4"
}
```

Handler получает такую ссылку через `input` или `config`. Для работы с файлом
ему доступны общие методы:

```python
local_file = await storage.download(reference, destination)
result_reference = await storage.upload(
    local_file,
    object_key="entries/files/example/processed.mp4",
    content_type="video/mp4",
)
await storage.delete(result_reference)
```

MinIO SDK синхронный, поэтому storage helper выполняет сетевые и файловые
операции через `asyncio.to_thread`. Handlers могут обрабатывать большие файлы во
временном каталоге, не загружая их целиком в RAM.

## Отправка прогресса

Для задачи без внутренних шагов reporter остаётся обычной async-функцией:

```python
await progress(25)
await progress(75)
```

Такие вызовы отправляют только общий `progress`.

Если задача состоит из шагов, сначала задайте их количество, а затем запускайте
шаги по очереди:

```python
await progress.set_total_steps(3)

await progress.start_step("Download source")
await storage.download(data.source, source_file)
await progress.complete_step()

await progress.start_step("Process media")
await progress.update_step(25)
await process_media(source_file, result_file)
await progress.complete_step()

await progress.start_step("Upload result")
await storage.upload(result_file, result_object_key)
await progress.complete_step()
```

`set_total_steps()` сразу отправляет событие с `progress=0` и запоминает
`totalSteps`. `start_step()` автоматически переходит к следующему шагу;
нумерация начинается с 1. `update_step()` принимает процент текущего шага, а
общий `progress` вычисляется автоматически. `complete_step()` эквивалентен
`update_step(100)`.

После задания шагов каждое событие содержит `totalSteps`, а во время активного
шага также содержит `step`, `stepName` и `stepProgress`.

## Тестовые handlers

### `test`

Отправляет progress events и возвращает тестовый результат. Чтобы проверить
ошибку handler-а, передайте:

```json
{
    "input": {
        "fail": true
    }
}
```

### `test.storage`

Скачивает объект во временный файл и загружает его под новым key:

```json
{
    "pipeline": "video_summary",
    "type": "test.storage",
    "taskId": 124,
    "callbackUrl": "http://127.0.0.1:3000/v1/tasks/events",
    "input": {
        "source": {
            "bucket": "remora",
            "objectKey": "entries/files/example/original.mp4"
        },
        "destinationObjectKey": "entries/files/example/processed.mp4",
        "contentType": "video/mp4"
    },
    "config": {}
}
```

Временный каталог удаляется как после успешного выполнения, так и после ошибки.

## Тесты

```bash
cd packages/worker
poetry install
poetry run pytest
```

Тесты используют fake MinIO client и не требуют запущенных MinIO или основного
ядра.

## Структура

```text
packages/worker/
├── pyproject.toml
├── poetry.lock
├── Dockerfile
├── src/worker/
│   ├── main.py
│   ├── config.py
│   ├── models.py
│   ├── callbacks.py
│   ├── storage.py
│   ├── dispatcher.py
│   └── handlers/
└── tests/
```
