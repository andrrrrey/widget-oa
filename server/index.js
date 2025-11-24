// server/index.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import adminRoutes from './adminRoutes.js';
import { trySendSummaryIfContact } from './telegram.js';

dotenv.config();

// ------------ ENV & OpenAI ------------
const PORT = process.env.PORT || 3000;
const ASSISTANT_ID = process.env.ASSISTANT_ID;

if (!process.env.OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY is not set in environment');
  process.exit(1);
}
if (!ASSISTANT_ID) {
  console.warn('WARN: ASSISTANT_ID is not set. /chat будет падать при запуске run.');
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Показывать ли источники (цитации файлов) в конце стрима
const SHOW_SOURCES = String(process.env.SHOW_SOURCES || 'true') === 'true';
// Удалять ли спец. маркеры из текста (в обычной работе да, для отладки — false)
const STRIP_ANNOTATIONS = !(String(process.env.STRIP_ANNOTATIONS || 'true') === 'false');
// Отправлять ли в TG: только при наличии контактных данных
const TELEGRAM_NOTIFY_IF_CONTACT = String(process.env.TELEGRAM_NOTIFY_IF_CONTACT || 'true') === 'true';

// ------------ App ------------
const app = express();
app.set('trust proxy', true);

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Клиентские приложения (виджет, админка) могут узнать актуальный API base
// (с учётом кастомного порта или префикса) из window.__WIDGET_API_BASE__ / __ADMIN_API_BASE__
const PUBLIC_API_BASE = process.env.PUBLIC_API_BASE || '/api';
app.get('/env.js', (req, res) => {
  // С учётом прокси: Express с trust proxy подтянет x-forwarded-* (протокол/хост/порт)
  const proto = req.protocol || req.get('x-forwarded-proto') || 'http';
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';

  // PUBLIC_API_BASE может быть как абсолютным (https://host:port/api), так и относительным (/prefix/api)
  const apiBase = new URL(PUBLIC_API_BASE, `${proto}://${host}`).toString().replace(/\/$/, '');
  const adminBase = new URL('./admin', `${apiBase}/`).toString().replace(/\/$/, '');

  res.type('application/javascript').send(
    `window.__WIDGET_API_BASE__ = ${JSON.stringify(apiBase)};\n` +
      `window.__ADMIN_API_BASE__ = ${JSON.stringify(adminBase)};\n`
  );
});

// Healthcheck (снаружи доступно как /api/ping)
app.get('/ping', (_req, res) => {
  res.json({ ok: true });
});

// Админ-роуты (/api/admin/* → /admin/* тут)
app.use('/admin', adminRoutes);

// Небольшой кэш имён файлов (file_id → filename), чтобы не дёргать API лишний раз
const fileNameCache = new Map();
async function fileNameById(file_id) {
  if (!file_id) return null;
  if (fileNameCache.has(file_id)) return fileNameCache.get(file_id);
  try {
    const meta = await openai.files.retrieve(file_id);
    const name = meta?.filename || file_id;
    fileNameCache.set(file_id, name);
    return name;
  } catch {
    return file_id;
  }
}

// ------------ SSE чат с ассистентом ------------
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body || {};
    let threadId = req.headers['x-thread-id'] || null;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'No message' });
    }
    if (!ASSISTANT_ID) {
      return res.status(500).json({ error: 'ASSISTANT_ID is not configured on server' });
    }

    // SSE заголовки
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // отключает буферизацию в nginx

    // Heartbeat (опционально)
    const hb = setInterval(() => {
      try { res.write(':\n\n'); } catch {}
    }, 15000);

    // Создаём тред, если его нет
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      res.write(`data: ${JSON.stringify({ info: { id: threadId } })}\n\n`);
      res.flush?.();
    }

    // Запуск run со стримингом
    let lastAssistantMsgId = null;

    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: ASSISTANT_ID,
      additional_messages: [{ role: 'user', content: message }],
      stream: true,
    });

    for await (const event of run) {
      // Запоминаем id сообщения ассистента
      if (event.event === 'thread.message.created' && event.data.role === 'assistant') {
        lastAssistantMsgId = event.data.id;
      }
      if (event.event === 'thread.message.completed' && event.data.role === 'assistant') {
        lastAssistantMsgId = event.data.id;
      }

      // Стрим текстовых чанков
      if (event.event === 'thread.message.delta') {
        const delta = event?.data?.delta;
        const part = Array.isArray(delta?.content) ? delta.content[0] : null;
        if (part?.type === 'text') {
          let chunk = part.text?.value ?? '';
          if (STRIP_ANNOTATIONS) {
            const annotationRegex = /【\d+:\d+†[^\s】]+】/g;
            chunk = chunk.replace(annotationRegex, '');
          }
          if (chunk.trim() !== '') {
            res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
            res.flush?.();
          }
        }
      }
    }

    // По окончании — опционально вернём источники (файлы), если ассистент сослался
    if (SHOW_SOURCES && lastAssistantMsgId) {
      try {
        const msg = await openai.beta.threads.messages.retrieve(threadId, lastAssistantMsgId);
        const sources = [];
        for (const part of msg?.content || []) {
          if (part.type === 'text' && Array.isArray(part.text?.annotations)) {
            for (const ann of part.text.annotations) {
              const fid =
                ann?.file_citation?.file_id ||
                ann?.file_path?.file_id ||
                null;
              if (fid) {
                sources.push({
                  file_id: fid,
                  filename: await fileNameById(fid),
                });
              }
            }
          }
        }
        if (sources.length) {
          res.write(`data: ${JSON.stringify({ sources })}\n\n`);
          res.flush?.();
        }
      } catch (e) {
        console.error('[SOURCES]', e?.message || e);
      }
    }

    // Отправка КРАТКОЙ выжимки в Telegram ТОЛЬКО если обнаружены контакты
    if (TELEGRAM_NOTIFY_IF_CONTACT) {
      try {
        await trySendSummaryIfContact(openai, threadId, {
          title: '🔔 Лид с контактами',
          // summaryModel: 'gpt-4o-mini', // можно переопределить через .env TELEGRAM_SUMMARY_MODEL
        });
      } catch (e) {
        console.error('[TELEGRAM] notify failed:', e?.message || e);
      }
    }

    res.write('data: [DONE]\n\n');
    clearInterval(hb);
    res.end();
  } catch (error) {
    console.error('Error in /chat:', error);
    try {
      res.write(`data: ${JSON.stringify({ error: 'Internal server error' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } catch {}
  }
});

// Фидбек (заглушка)
app.post('/feedback', async (_req, res) => {
  res.status(200).json({ message: 'Feedback received' });
});

// ------------ Start ------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
