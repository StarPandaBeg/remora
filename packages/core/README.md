# Remora Core

Node.js core — центральный HTTP API Remora. Он хранит данные приложения в
PostgreSQL, работает с файлами через MinIO, создаёт pipeline-задачи и отправляет
их на выполнение Python worker-у.

## Что находится в core

- Fastify HTTP API с Zod-валидацией и OpenAPI-документацией;
- папки, записи и связанные с ними файлы;
- PostgreSQL schema и repositories на Drizzle ORM;
- runtime-конфигурация с defaults и DB overrides;
- orchestrator для `TaskRun` и `TaskStep`;
- HTTP-клиент Python worker-а;
- MinIO object storage client.

Основной поток обработки выглядит так:

```text
Frontend
   |
   v
Fastify routes -> services -> repositories -> PostgreSQL
                       |
                       +-> MinIO
                       |
                       +-> orchestrator -> Python worker
                                              |
                                              +-> callback /v1/tasks/events
```

## Требования

- Docker с Compose plugin — для запуска всего stack;
- Node.js 22+ и npm 10 — только для локальной разработки core;
- Python 3.12+ и Poetry — только если worker также запускается локально.

## Быстрый запуск всего stack в Docker

### 1. Подготовить environment

Из корня репозитория:

```bash
cp .env.example .env
```

Обязательно замените `WORKER_SECRET` на случайное значение длиной не менее 32
символов. MinIO credentials из примера подходят только для локальной разработки.

### 2. Собрать и запустить

```bash
docker compose up --build -d
```

Compose запускает:

| Service          | Назначение                                               | Доступ с host                      |
| ---------------- | -------------------------------------------------------- | ---------------------------------- |
| `remora-db`      | PostgreSQL/pgvector                                      | `127.0.0.1:5432`                   |
| `remora-minio`   | Object storage и console                                 | `127.0.0.1:9000`, `127.0.0.1:9001` |
| `remora-worker`  | Python worker                                            | `127.0.0.1:8000`                   |
| `remora-db-init` | Одноразовый `drizzle-kit push`; после успеха завершается | не публикуется                     |
| `remora-core`    | Node.js API                                              | `127.0.0.1:3000`                   |

`remora-core` ждёт healthy PostgreSQL, MinIO и worker, а также успешного
завершения `remora-db-init`. Между контейнерами используются внутренние адреса
`remora-db`, `remora-minio`, `remora-worker` и `remora-core`.

Проверить состояние:

```bash
docker compose ps -a
docker compose logs -f remora-core
```

Для `remora-db-init` состояние `Exited (0)` является нормальным: schema уже
применена, после чего запускается core.

`db-init` не использует `--force`. Если Drizzle обнаружит потенциально
destructive изменение, проверьте `docker compose logs remora-db-init` и
примените такое изменение вручную после backup, а не обходите предупреждение в
автоматическом startup.

Проверка API:

```bash
curl http://127.0.0.1:3000/health
```

Ожидаемый ответ:

```json
{ "status": "ok" }
```

Swagger UI:

```text
http://127.0.0.1:3000/docs
```

Если внешний порт core меняется через `PORT`, одновременно задайте корректный
`PUBLIC_BASE_URL`, например:

```dotenv
PORT=4100
PUBLIC_BASE_URL=http://127.0.0.1:4100
```

Внутри Compose callback URL задаётся отдельно как
`http://remora-core:3000`, поэтому worker не пытается обращаться к container
localhost.

Host-порты инфраструктуры можно переопределить переменными `POSTGRES_PORT`,
`MINIO_PORT`, `MINIO_CONSOLE_PORT` и `WORKER_PORT`. Внутренние container ports
при этом не меняются.

## Локальная разработка core

Установите Node.js зависимости из корня monorepo:

```bash
npm install
```

Запустите инфраструктуру и worker в Docker, но не запускайте container core:

```bash
docker compose up --build -d remora-db remora-minio remora-worker
```

Когда worker находится в Docker, а core — на host-машине, задайте callback URL,
доступный из worker container. В Docker Desktop:

```dotenv
HOST=0.0.0.0
PUBLIC_BASE_URL=http://127.0.0.1:3000
WORKER_CALLBACK_BASE_URL=http://host.docker.internal:3000
WORKER_URL=http://127.0.0.1:8000
```

На Linux укажите в `WORKER_CALLBACK_BASE_URL` hostname/IP host-машины,
доступный из Compose network, либо настройте `host-gateway`.

Соберите Drizzle schema и примените её к локальной базе:

```bash
npm run build
npm run db:push --workspace=@remora/core
```

Drizzle config читает скомпилированную schema из `dist`, поэтому build перед
`db:push` обязателен. Команда изменяет базу из `POSTGRES_URL`; перед применением
к базе с важными данными проверьте diff и сделайте backup.

Запустите core с file watching:

```bash
npm run core:dev
```

Debug с Node inspector на `127.0.0.1:9229`:

```bash
npm run core:debug
```

Production-like локальный запуск:

```bash
npm run build
npm run core:start
```

Команды также можно запускать непосредственно через workspace:

```bash
npm run dev --workspace=@remora/core
npm run start --workspace=@remora/core
```

## Environment variables

Environment используется только для startup/infrastructure configuration.
Пользовательские runtime-настройки находятся в PostgreSQL и меняются через
`/v1/config` без перезапуска core.

| Переменная                 | Обязательна           | Default                 | Назначение                                                                                               |
| -------------------------- | --------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `HOST`                     | нет                   | `127.0.0.1`             | Интерфейс, на котором Fastify принимает подключения.                                                     |
| `PORT`                     | нет                   | `3000`                  | HTTP-порт core, от `1` до `65535`.                                                                       |
| `PUBLIC_BASE_URL`          | нет                   | `http://HOST:PORT`      | Внешний адрес core, используемый в URL файлов. Завершающий `/` удаляется.                                |
| `WORKER_CALLBACK_BASE_URL` | нет                   | `PUBLIC_BASE_URL`       | Адрес core, по которому worker отправляет callbacks. Завершающий `/` удаляется.                          |
| `POSTGRES_URL`             | да                    | —                       | PostgreSQL connection string.                                                                            |
| `WORKER_URL`               | нет                   | `http://127.0.0.1:8000` | Base URL Python worker-а. Завершающий `/` удаляется.                                                     |
| `WORKER_REQUEST_TIMEOUT`   | нет                   | `10000`                 | Timeout в миллисекундах только для `POST /tasks/execute`. Это не timeout выполнения задачи.              |
| `WORKER_SECRET`            | для рабочего pipeline | —                       | Секрет callback-запросов, минимум 32 символа. Если не задан, callback authentication всегда отклоняется. |
| `MAX_FILE_SIZE_BYTES`      | нет                   | `10737418240`           | Максимальный размер одного upload, по умолчанию 10 GiB.                                                  |
| `MINIO_ENDPOINT`           | нет                   | `127.0.0.1`             | Host MinIO без URL scheme.                                                                               |
| `MINIO_PORT`               | нет                   | `9000`                  | Порт MinIO API.                                                                                          |
| `MINIO_USE_SSL`            | нет                   | `false`                 | Использовать TLS; допустимы строки `true` или `false`.                                                   |
| `MINIO_ACCESS_KEY`         | да                    | —                       | MinIO access key.                                                                                        |
| `MINIO_SECRET_KEY`         | да                    | —                       | MinIO secret key.                                                                                        |
| `MINIO_BUCKET`             | нет                   | `remora`                | Bucket для файлов Remora.                                                                                |
| `MINIO_REGION`             | нет                   | `us-east-1`             | Регион bucket-а.                                                                                         |

Переменные `MAX_CONCURRENT_TASKS`, `HTTP_TIMEOUT`,
`FINAL_EVENT_RETRY_COUNT` и `FINAL_EVENT_RETRY_BASE_DELAY` из корневого
`.env.example` относятся к Python worker-у, а не к Node core.

При старте core проверяет MinIO bucket и создаёт его, если он отсутствует.

## Runtime config

Runtime config — глобальная конфигурация одной установки Remora. Source of
truth для overrides — PostgreSQL-таблица `config`:

```text
defaults из definitions.ts + DB overrides = effective runtime config
```

Известные настройки объявляются только в
[`src/api/config/definitions.ts`](src/api/config/definitions.ts). Сейчас
доступна настройка:

| Key                          | Тип     | Default | Назначение                                                         |
| ---------------------------- | ------- | ------- | ------------------------------------------------------------------ |
| `video_record.prefer_source` | boolean | `false` | Передать pipeline предпочтение использовать исходный video record. |

Получить effective config:

```bash
curl http://127.0.0.1:3000/v1/config
```

Частично обновить настройки:

```bash
curl -X PATCH http://127.0.0.1:3000/v1/config \
  -H 'content-type: application/json' \
  -d '{"video_record.prefer_source":true}'
```

PATCH меняет только переданные keys. Несколько значений одного запроса
записываются в транзакции. Неизвестный key или значение неверного типа приводит
к `400`.

Удалить DB override и вернуться к default:

```bash
curl -X DELETE \
  http://127.0.0.1:3000/v1/config/video_record.prefer_source
```

Чтобы добавить настройку, добавьте одну запись с `default` и Zod schema:

```ts
'summary.temperature': {
    default: 0.2,
    schema: z.number().min(0).max(1),
},
```

Key, TypeScript type, default, runtime validation, GET/PATCH, DB override и
reset выводятся из definitions автоматически. Если настройка нужна pipeline,
её дополнительно следует явно выбрать в `TaskDefinition.selectConfig`.

## Pipeline и worker

Определения задач находятся в `src/orchestrator/tasks/`, а registry — в
`src/orchestrator/tasks.ts`.

При создании подходящей записи core:

1. определяет применимые `TaskDefinition`;
2. читает effective runtime config;
3. вызывает чистую функцию `TaskDefinition.selectConfig`;
4. сохраняет выбранные значения в `TaskRun.config`;
5. создаёт `TaskStep` для каждого шага pipeline;
6. после commit запускает задачу;
7. передаёт worker-у input шага и сохранённый task-specific config.

`TaskRun.config` является snapshot. Изменение runtime config не меняет уже
созданную задачу, но применяется к новым задачам. Worker никогда не читает
global runtime config напрямую.

Core вызывает worker:

```text
POST {WORKER_URL}/tasks/execute
```

В запрос входят `pipeline`, тип шага, `taskId`, `callbackUrl`, `input` и
task-specific `config`. Успешный worker должен ответить HTTP `202` и JSON:

```json
{ "accepted": true }
```

Worker отправляет события в:

```text
POST {WORKER_CALLBACK_BASE_URL}/v1/tasks/events
x-worker-secret: <WORKER_SECRET>
```

Поддерживаются события `task.started`, `task.progress`, `task.completed` и
`task.failed`.

## HTTP API

Все прикладные endpoints имеют prefix `/v1`. Актуальные request/response schemas
всегда доступны в Swagger UI на `/docs`.

### System

| Метод | Path      | Назначение                    |
| ----- | --------- | ----------------------------- |
| `GET` | `/`       | Приветственное сообщение API. |
| `GET` | `/health` | Liveness-проверка core.       |

### Config

| Метод    | Path              | Назначение                              |
| -------- | ----------------- | --------------------------------------- |
| `GET`    | `/v1/config`      | Получить effective runtime config.      |
| `PATCH`  | `/v1/config`      | Частично обновить DB overrides.         |
| `DELETE` | `/v1/config/:key` | Удалить override и вернуться к default. |

### Folders

| Метод    | Path                     | Назначение                                        |
| -------- | ------------------------ | ------------------------------------------------- |
| `GET`    | `/v1/folders?depth=3`    | Получить дерево папок. Максимальная глубина — 10. |
| `POST`   | `/v1/folders`            | Создать папку.                                    |
| `PATCH`  | `/v1/folders/:id`        | Изменить имя или описание.                        |
| `PATCH`  | `/v1/folders/:id/parent` | Переместить папку.                                |
| `DELETE` | `/v1/folders/:id`        | Удалить папку и связанные descendants.            |

Пример создания корневой папки:

```bash
curl -X POST http://127.0.0.1:3000/v1/folders \
  -H 'content-type: application/json' \
  -d '{"name":"Inbox","parentId":null}'
```

### Entries

| Метод    | Path                       | Назначение                                               |
| -------- | -------------------------- | -------------------------------------------------------- |
| `GET`    | `/v1/entries/tree?depth=3` | Получить общее дерево папок и записей.                   |
| `POST`   | `/v1/entries`              | Создать note из JSON или file-backed entry из multipart. |
| `GET`    | `/v1/entries/:id/file`     | Скачать или открыть прикреплённый файл.                  |
| `PATCH`  | `/v1/entries/:id`          | Изменить запись.                                         |
| `PATCH`  | `/v1/entries/:id/folder`   | Переместить запись.                                      |
| `DELETE` | `/v1/entries/:id`          | Удалить запись.                                          |

Пример создания note:

```bash
curl -X POST http://127.0.0.1:3000/v1/entries \
  -H 'content-type: application/json' \
  -d '{"type":"note","folderId":1,"name":"Meeting","content":"Notes"}'
```

Пример загрузки video record:

```bash
curl -X POST http://127.0.0.1:3000/v1/entries \
  -F type=video_record \
  -F folderId=1 \
  -F name='Lecture' \
  -F file=@./lecture.mp4
```

Файл сначала записывается в MinIO. Если сохранение entry в PostgreSQL
завершается ошибкой, core пытается удалить уже загруженный объект.

### Tasks

| Метод  | Path                  | Назначение                                                |
| ------ | --------------------- | --------------------------------------------------------- |
| `GET`  | `/v1/tasks`           | Получить задачи; можно фильтровать параметром `statuses`. |
| `GET`  | `/v1/tasks/:id`       | Получить задачу вместе с шагами.                          |
| `POST` | `/v1/tasks/:id/start` | Запустить pending-задачу вручную.                         |
| `POST` | `/v1/tasks/events`    | Callback worker-а; требует `x-worker-secret`.             |

При создании поддерживаемой записи связанные pipeline-задачи создаются и
запускаются автоматически после успешного commit.

## Безопасность

Core пока рассчитан на single-user deployment и не содержит authentication для
пользовательских `/v1` endpoints. Не публикуйте API напрямую в интернет без
reverse proxy, сетевых ограничений или внешнего authentication layer.

Worker callback защищён заголовком `x-worker-secret`. Используйте длинное
случайное значение `WORKER_SECRET`, одинаковое для core и worker-а. PostgreSQL и
MinIO credentials остаются infrastructure secrets и передаются через
environment; они не должны попадать в runtime config API.

TLS завершается вне core — например, на reverse proxy.

## База данных

Schema находится в [`src/database/schema.ts`](src/database/schema.ts).

В полном Compose stack schema автоматически синхронизируется одноразовым
service `remora-db-init` до запуска core. При локальном запуске используйте
`npm run build` и `npm run db:push --workspace=@remora/core`. Сам процесс core
не изменяет schema при старте.

Основные таблицы:

- `folders` — иерархия папок;
- `entries` — notes, video records и обычные файлы;
- `config` — JSONB overrides runtime config по ключам;
- `task_runs` — состояние pipeline и immutable config snapshot;
- `task_steps` — шаги, их input/output/context/error и статусы.

Удаление папок, записей и task runs каскадно удаляет зависимые строки согласно
foreign keys schema.

## Структура исходников

```text
src/
├── api/
│   ├── config/       # definitions, effective config, repository и routes
│   ├── entries/      # записи и файлы
│   ├── folders/      # дерево папок
│   └── tasks/        # task API и persistence
├── database/         # Drizzle schema и database client
├── http/             # multipart, validation и file responses
├── orchestrator/     # TaskDefinition, pipeline registry и worker dispatch
├── plugins/          # Fastify dependencies и Swagger
├── storage/          # MinIO/ObjectStorage abstraction
├── config.ts         # infrastructure config из environment
├── repositories.ts   # repository registry и transactions
├── services.ts       # service registry
├── routes.ts         # корневая регистрация routes
└── server.ts         # executable entrypoint
```

Container image описан в [`Dockerfile`](Dockerfile). Build stage устанавливает
dev dependencies и компилирует TypeScript; runtime stage содержит только
production dependencies и `dist`. Корневой `.dockerignore` исключает локальные
dependencies, build artifacts, `.env` и Python virtual environments.

### Слои

- Routes отвечают за HTTP transport и Zod schemas.
- Services содержат application use cases.
- Repositories изолируют операции с PostgreSQL.
- Orchestrator управляет жизненным циклом pipeline.
- Task definitions описывают применимость задачи, шаги и config snapshot.
- Worker client отвечает только за HTTP dispatch.

Зависимости создаются в `src/plugins/dependencies.ts` и декорируют Fastify
instance. В тестах database и object storage можно подменить через `AppOptions`.

## Проверки и разработка

Из корня репозитория:

```bash
# TypeScript
npm run typecheck

# ESLint
npm run lint

# Проверка форматирования
npm run format:check

# Build всех workspace packages
npm run build

# Тесты core
node --test packages/core/src/**/*.test.ts
```

Автоматическое форматирование:

```bash
npm run format
```

Очистить TypeScript build artifacts core:

```bash
npm run clean --workspace=@remora/core
```

## Остановка stack

```bash
docker compose down
```

Команда не удаляет PostgreSQL и MinIO volumes. Не добавляйте `--volumes`, если
данные должны сохраниться.
