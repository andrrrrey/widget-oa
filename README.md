# Widget OA — чат-виджет с админкой и базой знаний (OpenAI Assistants)

Интегрируемый на сайт чат-виджет с потоковыми ответами (SSE), админкой для правки инструкции ассистента и управления файлами в базе знаний (Vector Store).
Бэкенд на Express проксируется через Nginx; сборка фронта — Vite/TS; процессы — PM2.

---

## Возможности

* Встраиваемый JS-виджет (IIFE), не требует фреймворков на стороне сайта.
* Потоковые ответы ассистента (Server-Sent Events) — мгновенная отдача текста.
* Админка:

  * редактирование `instructions` ассистента;
  * загрузка/удаление файлов в Vector Store (OpenAI).

* Бэкенд (API_BASE по умолчанию `/futuguru/api`):

* `API_BASE/chat` — чат со стримингом;
* `API_BASE/admin/settings` — чтение/запись инструкции;
* `API_BASE/admin/files` — список/загрузка/удаление файлов.
* Готов для продакшена: Nginx, PM2, `.env`-конфигурация.

---

## Архитектура

```
Nginx
 ├─ /clubsante/app/*     → статика (SPA-пример)
 ├─ /clubsante/admin/*   → админка (index.html, js, css)
 ├─ /clubsante/widget/*  → виджет (widget.iife.js)
 └─ /futuguru/api/*      → прокси на Node (Express, порт 3000)

Node (Express)
 ├─ POST /futuguru/api/chat                     → SSE в OpenAI Assistants
 ├─ GET  /futuguru/api/admin/settings           → получить инструкции
 ├─ PUT  /futuguru/api/admin/settings           → сохранить инструкции
 ├─ GET  /futuguru/api/admin/files              → список файлов Vector Store
 ├─ POST /futuguru/api/admin/files              → загрузка файлов (multer)
 └─ DELETE /futuguru/api/admin/files/:id        → удаление file_*/vsfile_* (совм.)
```

---

## Структура репозитория

```
.
├─ server/
│  ├─ index.js            # Express-сервер, /api/* + подключение админ-маршрутов
│  └─ adminRoutes.js      # /api/admin/* (settings, files)
├─ src/                   # исходники SPA/демо/виджета
├─ dist/
│  ├─ app/                # сборка SPA (vite build)
│  └─ widget/             # сборка виджета (vite build --config vite.widget.config.ts)
├─ package.json
├─ vite.config.ts
├─ vite.widget.config.ts
└─ .env.example
```

---

## Требования

* Node.js 20+ (желательно LTS)
* NPM 9+ / PNPM / Yarn (пример — NPM)
* Доступ к OpenAI API (валидный `OPENAI_API_KEY`)
* Nginx (для продакшена)
* PM2 (для продакшена)

---

## Переменные окружения (`.env`)

Создайте `.env` в корне проекта (рядом с `package.json`):

```env
# Обязательно
OPENAI_API_KEY=sk-...

# Ассистент, с которым работает чат
ASSISTANT_ID=asst_xxxxx

# Необязательно: будет создан автоматически при первом апдейте/загрузке файлов
# Если заранее известен — ускорит старт:
VECTOR_STORE_ID=vs_xxxxx

# Сетевые параметры
PORT=3000
```

> Если `VECTOR_STORE_ID` не задан, бэкенд создаст новый Vector Store при первом
> `PUT /api/admin/settings` или `POST /api/admin/files` и запишет его в переменную окружения процесса.

---

## Установка

```bash
npm install
```

Обязательные зависимости для сервера (уже в `package.json`, но на всякий случай):

```bash
npm i openai multer express cors compression helmet dotenv
```

---

## Скрипты NPM

В `package.json` есть стандартные скрипты:

```json
{
  "scripts": {
    "dev": "vite",
    "server": "node server/index.js",
  "build": "npm run build:app && npm run build:widget && npm run build:admin",
  "build:app": "tsc && vite build",
  "build:widget": "vite build --config vite.widget.config.ts",
  "build:admin": "node scripts/build-admin.js",
  "deploy": "node scripts/deploy.js",
  "start": "node server/index.js",
  "preview": "vite preview"
  }
}
```

> Обратите внимание: **сборка сервера как таковая не нужна** — он запускается напрямую (`node server/index.js`).
> Скрипт `build` собирает фронт: `dist/app`, `dist/widget` и копирует админку в `dist/admin`.
> Скрипт `deploy` копирует содержимое `dist/{app,widget,admin}` в `/var/www/futuguru` (или другой путь через `DEPLOY_TARGET`).

---

## Локальный запуск (dev)

В одном терминале (фронт, если используете SPA/демо):

```bash
npm run dev
```

В другом терминале (сервер API):

```bash
npm run server
# или
node server/index.js
```

По умолчанию сервер слушает `http://localhost:3000`.

Проверка здоровья:

```bash
curl -sS http://localhost:3000/api/ping
@@ -193,55 +196,58 @@ server {
    add_header X-Accel-Buffering no;
  }

  # Статика
  location ^~ /clubsante/app/   { alias /var/www/clubsante/app/;   index index.html; try_files $uri $uri/ /clubsante/app/index.html; }
  location ^~ /clubsante/admin/ { alias /var/www/clubsante/admin/; index index.html; try_files $uri $uri/ /clubsante/admin/index.html; }
  location ^~ /clubsante/widget/ { alias /var/www/clubsante/widget/; try_files $uri =404; }

  # SSL
  ssl_certificate     /etc/letsencrypt/live/dev.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/dev.example.com/privkey.pem;
  include             /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;
}

server {
  listen 80;
  server_name dev.example.com;
  return 301 https://$host$request_uri;
}
```

Разложить собранные файлы:

```bash
sudo mkdir -p /var/www/futuguru/{app,admin,widget}
sudo rsync -a --delete dist/app/    /var/www/futuguru/app/
sudo rsync -a --delete dist/admin/  /var/www/futuguru/admin/
sudo rsync -a --delete dist/widget/ /var/www/futuguru/widget/
sudo chown -R www-data:www-data /var/www/futuguru

# или одной командой после npm run build:
# DEPLOY_TARGET=/var/www/futuguru npm run deploy
sudo nginx -t && sudo systemctl reload nginx
```

PM2:

```bash
# первый запуск
pm2 start server/index.js --name clubsante

# обновить окружение/переменные
pm2 restart clubsante --update-env

# автозапуск после перезагрузки
pm2 save
pm2 startup
```

---

## Встраивание виджета на сайт

После деплоя виджет доступен по `https://<host>/clubsante/widget/widget.iife.js`.

Подключите на любой странице:

```html
<script
  src="https://dev.example.com/clubsante/widget/widget.iife.js"
  data-api="https://dev.example.com/api">
</script>
```

> `data-api` — базовый URL вашего API. Виджет отправляет POST `/api/chat` (SSE) с телом `{ message }`.

---

## Админка

Админка — статическая страница (например, `https://dev.example.com/clubsante/admin/`):

* блок **Инструкция ассистента**:

  * GET `/api/admin/settings` → `{ instructions, model?, tools? }`
  * PUT `/api/admin/settings` → `{ ok: true, vector_store_id }`
* блок **Файлы**:

  * GET `/api/admin/files` → `{ vector_store_id, data: [...] }`
  * POST `/api/admin/files` (multipart, поле `files`, можно несколько)
  * DELETE `/api/admin/files/:id` (`id` = `file_*` или `vsfile_*` или точное имя файла)

---

## API (быстрые примеры)

**Пинг**

```bash
curl -sS https://dev.example.com/api/ping
```

**Чат (SSE)**

```bash
curl -N -H "Content-Type: application/json" \
     -X POST https://dev.example.com/api/chat \
     -d '{"message":"Привет!"}'
```

**Инструкция**

```bash
# прочитать
curl -sS https://dev.example.com/api/admin/settings | jq .

# сохранить
curl -sS -X PUT https://dev.example.com/api/admin/settings \
  -H 'Content-Type: application/json' \
  -d '{"instructions":"Новый текст..."}' | jq .
```

**Файлы**

```bash
# список
curl -sS https://dev.example.com/api/admin/files | jq .

# загрузка (multipart)
curl -sS -X POST https://dev.example.com/api/admin/files \
  -F 'files=@/path/file1.pdf' -F 'files=@/path/file2.docx' | jq .

# удаление
curl -sS -X DELETE https://dev.example.com/api/admin/files/file-xxxxxxxx | jq .
```

---

## Частые ошибки и решения

* **`404 Not Found` при запросах к `/api/*` через домен**
  Проверьте в Nginx:

  * `location /api/ { proxy_pass http://127.0.0.1:3000/; }` — слэш в конце обязателен.
  * Сервер Node слушает `:3000` и реально запущен (`ss -lntp | grep 3000`).

* **`502 Bad Gateway`**
  Node не слушает порт (упал) или блокирует firewall. Посмотрите `pm2 logs clubsante`.

* **`OPENAI_API_KEY is missing`**
  Добавьте ключ в `.env` и перезапустите PM2 c `--update-env`:

  ```bash
  pm2 restart clubsante --update-env
  ```

* **`Cannot read properties of undefined (reading 'files')` / `retrieve`**
  Версия SDK OpenAI несовместима. Обновите:

  ```bash
  npm i openai@latest
  ```

  В коде предусмотрены фолбэки: `client.beta.vectorStores` и `client.vectorStores`.
  Для загрузки используется `fileBatches.uploadAndPoll`.

* **`multer` не найден**

  ```bash
  npm i multer@^1.4.5-lts.2
  ```

* **SSE обрывается за прокси**
  Убедитесь в заголовках:

  * на сервере: `Content-Type: text/event-stream`, `X-Accel-Buffering: no`;
  * в Nginx: `proxy_buffering off; proxy_read_timeout 3600;`.

* **Виджет не подключается**
  Проверьте атрибут `data-api` и CORS на бэкенде (`app.use(cors())` включён).

---

## Безопасность

* Админка сейчас без аутентификации и доступна всем, кто знает URL.
  В продакшене добавьте auth (Basic, JWT, IP-фильтр, VPN, SSO) и/или перенесите `/api/admin/*` за приватный контур.
* Ограничьте размер загружаемых файлов (в `multer` уже стоит `25MB`, при необходимости меняйте).
* Регулярно обновляйте зависимости (`npm audit`).

---

## Roadmap (идеи)

* Авторизация админки.
* Интеграции: CRM (amo/Bitrix/HubSpot), Telegram/WhatsApp-боты.
* Мультиязычность виджета.
* Аналитика диалогов и статусов лидов.
* A/B-тональность, анти-галлюцинации (правила, фильтры).

---

## Лицензия

MIT — используйте и адаптируйте под свои задачи.

---

## Поддержка

Если что-то не заводится:

1. `pm2 logs clubsante` — ошибки сервера.
2. `curl -i https://<host>/api/ping` — проверка маршрута через Nginx.
3. Сравните версию `openai`:

   ```bash
   node -p "require('./node_modules/openai/package.json').version"
   ```
4. Проверьте `.env` и что PM2 «подхватил» переменные (`pm2 restart --update-env`).
