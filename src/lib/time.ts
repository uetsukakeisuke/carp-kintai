// 日本時間（Asia/Tokyo）での日付と時刻。サーバーは UTC で動くため必ずここを通す。

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

export function jstParts(d = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export const WD = ['日', '月', '火', '水', '木', '金', '土'];

export function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 分 → "9:05"。1440 以上は "25:30" のように表示 */
export function hm(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}
/** 分 → "9" / "9:30"（シフト表の短い表示） */
export function hshort(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}:${String(m).padStart(2, '0')}` : String(h);
}
export function hoursLabel(min: number): string {
  return `${Math.floor(min / 60)}時間${String(min % 60).padStart(2, '0')}分`;
}
export function dateLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}（${WD[weekday(date)]}）`;
}
export function yen(n: number): string {
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}

/** 深夜営業の店舗向け：この時刻より前の打刻は、前日からの続きの勤務として扱える */
export const DAY_BOUNDARY_MIN = 5 * 60;
