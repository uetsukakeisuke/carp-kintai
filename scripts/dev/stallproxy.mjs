// 指定した番号の接続だけ、つないだまま何も返さない（プーラーが固まった状態の再現）
import net from 'node:net';
const stall = new Set((process.env.STALL || '1').split(',').map(Number));
let n = 0;
net.createServer((c) => {
  n++;
  const id = n;
  if (stall.has(id)) { console.log('stall conn', id); c.on('error', () => {}); return; }
  console.log('pass conn', id);
  const u = net.connect(5433, '127.0.0.1');
  c.pipe(u); u.pipe(c);
  c.on('error', () => u.destroy()); u.on('error', () => c.destroy());
}).listen(5434, () => console.log('proxy on 5434'));
