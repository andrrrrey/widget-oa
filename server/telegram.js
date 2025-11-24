// server/telegram.js
// Отправляет текст в Telegram + утилита: проверить наличие контактов в треде,
// при наличии — сгенерировать краткую выжимку и отправить.

const TG_API_BASE = 'https://api.telegram.org';

// --- ENV helpers ---
function getEnv(key, fallback = undefined) {
  const v = process.env[key];
  return (v === undefined || v === null || v === '') ? fallback : v;
}

// --- Telegram low-level ---
export async function sendTelegramText(text, {
  botToken = getEnv('TELEGRAM_BOT_TOKEN'),
  chatId   = getEnv('TELEGRAM_CHAT_ID'),
} = {}) {
  if (!botToken || !chatId) {
    // тихо выходим: не настроено
    return;
  }
  // Разбиваем на куски (лимит у Telegram ~4096 символов)
  const MAX = 3800;
  const chunks = [];
  for (let i = 0; i < text.length; i += MAX) chunks.push(text.slice(i, i + MAX));

  for (const chunk of chunks) {
    const resp = await fetch(`${TG_API_BASE}/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // без parse_mode, чтобы не париться с экранированием HTML/Markdown
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        disable_web_page_preview: true,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error('[TELEGRAM] sendMessage failed:', resp.status, body);
      break;
    }
  }
}

// --- Контакты: эвристики обнаружения ---
export function extractContactsFromText(text) {
  if (!text) return [];

  const contacts = new Set();

  // email
  const emailRe = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  for (const m of text.matchAll(emailRe)) contacts.add(m[0]);

  // телефон (грубая эвристика: 8+ цифр, допускаем +, пробелы, тире, скобки)
  const phoneRe = /(?:(?:\+|00)?\d[\s\-().]*){8,}\d/g;
  for (const m of text.matchAll(phoneRe)) contacts.add(m[0]);

  // telegram username / t.me / whatsapp
  const tgUserRe = /@[\w\d_]{5,}/g;
  const linkRe = /\b(?:https?:\/\/)?(?:t\.me|wa\.me|whatsapp\.com)\/[^\s]+/gi;
  for (const m of text.matchAll(tgUserRe)) contacts.add(m[0]);
  for (const m of text.matchAll(linkRe)) contacts.add(m[0]);

  return Array.from(contacts);
}

// --- Собираем последние сообщения треда в компактный текст ---
async function getRecentThreadText(openai, threadId, { limit = 20 } = {}) {
  const list = await openai.beta.threads.messages.list(threadId, {
    order: 'asc',
    limit,
  });
  const msgs = Array.isArray(list?.data) ? list.data : [];
  let buf = '';
  for (const m of msgs) {
    const role = m.role || 'assistant';
    const parts = Array.isArray(m.content) ? m.content : [];
    const texts = parts
      .filter(p => p?.type === 'text' && p?.text?.value)
      .map(p => p.text.value.trim());
    if (texts.length === 0) continue;
    buf += `[${role}]\n${texts.join('\n')}\n\n`;
  }
  return buf.trim();
}

// --- Найти контакты в последних сообщениях пользователя ---
async function findContactsInThread(openai, threadId, { scanLimit = 30 } = {}) {
  const list = await openai.beta.threads.messages.list(threadId, {
    order: 'desc',
    limit: scanLimit,
  });
  const msgs = Array.isArray(list?.data) ? list.data : [];
  const contacts = new Set();

  for (const m of msgs) {
    if (m.role !== 'user') continue;
    const parts = Array.isArray(m.content) ? m.content : [];
    const texts = parts
      .filter(p => p?.type === 'text' && p?.text?.value)
      .map(p => p.text.value);
    for (const t of texts) {
      for (const c of extractContactsFromText(t)) contacts.add(c);
    }
  }

  return Array.from(contacts);
}

// --- Суммаризация через OpenAI (короткая выжимка) ---
async function summarizeThread(openai, threadId, {
  model = getEnv('TELEGRAM_SUMMARY_MODEL', 'gpt-4o-mini'),
  maxTokens = 220,
  maxMessages = 20,
  locale = getEnv('SUMMARY_LOCALE', 'ru'), // 'ru' по умолчанию
} = {}) {
  const context = await getRecentThreadText(openai, threadId, { limit: maxMessages });
  if (!context) return null;

  const system = locale === 'ru'
    ? 'Ты помогаешь делать сверхкраткие выжимки диалога. Дай 3–5 лаконичных маркеров: суть запроса пользователя, что уже ответили, и следующие шаги. Без лишней воды.'
    : 'You produce ultra-brief conversation summaries. Return 3–5 bullets with user intent, what was answered, and next steps. Be concise.';

  const completion = await openai.chat.completions.create({
    model,
    max_tokens: maxTokens,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: context },
    ],
  });

  return completion?.choices?.[0]?.message?.content || null;
}

/**
 * Главная утилита:
 * - ищет контакты в треде,
 * - если нашли — делает краткую выжимку и отправляет в Telegram.
 */
export async function trySendSummaryIfContact(openai, threadId, {
  title = '🔔 Лид с контактами',
  summaryModel,
  chatId = getEnv('TELEGRAM_CHAT_ID'),
  botToken = getEnv('TELEGRAM_BOT_TOKEN'),
} = {}) {
  if (!botToken || !chatId) return;

  const contacts = await findContactsInThread(openai, threadId, { scanLimit: 30 });
  if (!contacts.length) {
    // нет контактов — ничего не отправляем
    return;
  }

  let summary = null;
  try {
    summary = await summarizeThread(openai, threadId, {
      model: summaryModel,
      maxTokens: 220,
      maxMessages: 20,
    });
  } catch (e) {
    console.error('[TELEGRAM] summarize failed:', e?.status || '', e?.message || e);
  }

  const lines = [];
  lines.push(title);
  lines.push(`Thread: ${threadId}`);
  lines.push('');
  lines.push('Контакты:');
  for (const c of contacts) lines.push(`• ${c}`);
  if (summary) {
    lines.push('');
    lines.push('Краткая выжимка:');
    lines.push(summary);
  }

  await sendTelegramText(lines.join('\n'), { botToken, chatId });
}
