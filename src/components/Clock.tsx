'use client';
import { useEffect, useState } from 'react';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
function parts() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  return { md: `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`, h: String(d.getHours()).padStart(2, '0'), m: String(d.getMinutes()).padStart(2, '0'), s: String(d.getSeconds()).padStart(2, '0') };
}
export function Clock() {
  const [p, setP] = useState<ReturnType<typeof parts> | null>(null);
  useEffect(() => { setP(parts()); const t = setInterval(() => setP(parts()), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="clockbig" aria-live="off">
      <div className="cd">{p?.md ?? ' '}</div>
      <div className="ct num">{p ? <>{p.h}:{p.m}<small>:{p.s}</small></> : '--:--'}</div>
    </div>
  );
}
