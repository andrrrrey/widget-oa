import fs from 'fs';
import path from 'path';

const src = path.resolve('admin');
const dest = path.resolve('dist/admin');

if (!fs.existsSync(src)) {
  console.error(`Admin source directory not found: ${src}`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(src, dest, { recursive: true });

console.log('Admin panel copied to dist/admin');