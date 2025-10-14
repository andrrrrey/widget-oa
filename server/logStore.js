// server/logStore.js
import fs from 'fs';
import path from 'path';

const LOG_DIR = process.env.LOG_DIR || '/opt/widget-oa/logs';
const MAX_PER_THREAD = Number(process.env.LOG_MAX_PER_THREAD || 200);

// Память: threadId -> [{ ts, role, content, ...meta }]
const STORE = new Map();

// гарантируем наличие директории логов
function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
}
ensureDir(LOG_DIR);

// threadId в безопасный вид для имени файла
function sanitizeId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_\-]/g, '_');
}

function appendJSONL(filePath, obj) {
  const line = JSON.stringify(obj) + '\n';
  fs.promises.appendFile(filePath, line).catch(() => {
    // тихо съедаем: логирование не должно ронять запрос
  });
}

/**
 * Добавить сообщение в историю треда.
 * @param {string} threadId
 * @param {'user'|'assistant'|'system'} role
 * @param {string} content
 * @param {object} meta - любые доп.поля (например, sources)
 */
export function addMessage(threadId, role, content, meta = {}) {
  if (!threadId) throw new Error('threadId is required');
  if (!content && content !== '') throw new Error('content is required');

  const tId = sanitizeId(threadId);
  const ts = Date.now();
  const entry = { ts, role, content, ...meta };

  const arr = STORE.get(tId) || [];
  arr.push(entry);
  // ограничиваем размер истории в памяти
  if (arr.length > MAX_PER_THREAD) {
    arr.splice(0, arr.length - MAX_PER_THREAD);
  }
  STORE.set(tId, arr);

  // пишем на диск: в файл треда и в общий
  const perThreadFile = path.join(LOG_DIR, `${tId}.jsonl`);
  const allFile = path.join(LOG_DIR, `all.jsonl`);
  const lineObj = { threadId: tId, ...entry };

  appendJSONL(perThreadFile, lineObj);
  appendJSONL(allFile, lineObj);
}

/**
 * Получить историю треда (массив объектов {ts, role, content, ...}).
 * Возвращает копию (чтобы снаружи не портили внутреннее хранилище).
 * @param {string} threadId
 */
export function getThread(threadId) {
  const tId = sanitizeId(threadId);
  const arr = STORE.get(tId) || [];
  return arr.map(x => ({ ...x }));
}

/**
 * Список известных тредов в памяти с краткой сводкой.
 * Полезно для отладки/админки.
 */
export function listThreads() {
  const out = [];
  for (const [tId, arr] of STORE.entries()) {
    const last = arr[arr.length - 1];
    out.push({
      threadId: tId,
      count: arr.length,
      lastTs: last?.ts ?? null,
      lastRole: last?.role ?? null,
    });
  }
  // самые свежие сверху
  out.sort((a, b) => (b.lastTs ?? 0) - (a.lastTs ?? 0));
  return out;
}

/**
 * Удалить историю треда из памяти и (опционально) с диска.
 * @param {string} threadId
 * @param {boolean} removeFiles - по умолчанию false (файлы оставим)
 */
export async function clearThread(threadId, removeFiles = false) {
  const tId = sanitizeId(threadId);
  STORE.delete(tId);
  if (removeFiles) {
    const perThreadFile = path.join(LOG_DIR, `${tId}.jsonl`);
    try { await fs.promises.unlink(perThreadFile); } catch {}
  }
}

/**
 * Экспорт истории в простой текст (для Telegram или e-mail).
 * @param {string} threadId
 */
export function exportThreadPlain(threadId) {
  const arr = getThread(threadId);
  return arr.map(m => {
    const dt = new Date(m.ts).toISOString().replace('T', ' ').replace('Z', '');
    const role = (m.role || 'role').toUpperCase();
    return `[${dt}] ${role}:\n${m.content || ''}`;
  }).join('\n\n');
}
