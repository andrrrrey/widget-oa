import fs from 'fs';
import path from 'path';

const targetRoot = process.env.DEPLOY_TARGET || '/var/www/futuguru';
const distRoot = path.resolve('dist');

const entries = [
  { name: 'app', source: path.join(distRoot, 'app') },
  { name: 'admin', source: path.join(distRoot, 'admin') },
  { name: 'widget', source: path.join(distRoot, 'widget') }
];

function ensureNotEmpty(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Не найдено: ${dir}`);
  }
  const items = fs.readdirSync(dir);
  if (items.length === 0) {
    throw new Error(`Каталог пустой: ${dir}`);
  }
}

for (const entry of entries) {
  ensureNotEmpty(entry.source);

  const dest = path.join(targetRoot, entry.name);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(entry.source, dest, { recursive: true });
  console.log(`Скопировано ${entry.source} → ${dest}`);
}

console.log('\nГотово. Статика находится в', targetRoot);
console.log('Если нужен другой путь, задайте переменную DEPLOY_TARGET=/var/www/имя');