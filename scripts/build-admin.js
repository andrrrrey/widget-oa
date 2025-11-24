import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const src = path.resolve('admin');
const dest = path.resolve('dist/admin');

if (!fs.existsSync(src)) {
  console.error(`Admin source directory not found: ${src}`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dest), { recursive: true });

const PUBLIC_API_BASE = process.env.PUBLIC_API_BASE || '/api';

// Подставляем PUBLIC_API_BASE из .env прямо в admin/index.html,
// чтобы фронт сразу знал нужный префикс (/futuguru/api и т.п.).
const indexSrc = path.join(src, 'index.html');
const indexDest = path.join(dest, 'index.html');

let html = fs.readFileSync(indexSrc, 'utf8');
html = html.replace(/__PUBLIC_API_BASE_PLACEHOLDER__/g, JSON.stringify(PUBLIC_API_BASE));
fs.mkdirSync(dest, { recursive: true });
fs.writeFileSync(indexDest, html);

// Остальные файлы копируем как есть
for (const entry of fs.readdirSync(src)) {
  if (entry === 'index.html') continue;
  fs.cpSync(path.join(src, entry), path.join(dest, entry), { recursive: true });
}

console.log('Admin panel copied to dist/admin');