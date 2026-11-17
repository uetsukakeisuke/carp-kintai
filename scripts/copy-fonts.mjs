// 文字（フォント）を public/fonts/ に用意する（ビルドの前に自動で動く）。
// npm の @fontsource から、使う太さの woff2 だけを取り出し、1つの CSS（fonts.css）にまとめる。
// この CSS は画面の表示を止めずに後から読む（app/layout.tsx）。最初の表示を速くするため。
import fs from 'node:fs';
import path from 'node:path';

const V = 'v1'; // 中身を変えたら上げる（ブラウザに長く覚えさせるので）
const OUT = path.join('public', 'fonts', V);
const LIST = [
  ['biz-udpgothic', '400'], ['biz-udpgothic', '700'],
  ['zen-kaku-gothic-new', '500'], ['zen-kaku-gothic-new', '700'],
  ['ibm-plex-mono', 'latin-500'], ['ibm-plex-mono', 'latin-600'],
];
fs.rmSync(path.join('public', 'fonts'), { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let css = '', files = 0;
for (const [pkg, w] of LIST) {
  const dir = path.join('node_modules', '@fontsource', pkg);
  let s = fs.readFileSync(path.join(dir, `${w}.css`), 'utf8');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/,\s*url\([^)]*\.woff\) format\('woff'\)/g, '');
  s = s.replace(/url\(\.\/files\/([^)]+\.woff2)\)/g, (_, f) => {
    fs.copyFileSync(path.join(dir, 'files', f), path.join(OUT, f)); files++;
    return `url(/fonts/${V}/${f})`;
  });
  css += s.replace(/\s*\n\s*/g, '').replace(/;\}/g, '}') + '\n';
}
fs.writeFileSync(path.join(OUT, 'fonts.css'), css);
console.log(`fonts: ${files} files, fonts.css ${Math.round(css.length / 1024)}KB`);
