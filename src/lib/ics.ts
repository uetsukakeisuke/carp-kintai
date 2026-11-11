// iCalendar（.ics）を組み立てる。Googleカレンダー・iPhoneのカレンダー・Outlook などが読める形式（RFC 5545）。
// 時刻はすべて日本時間（Asia/Tokyo）。データベースに触れない純粋な関数だけを置く。

export type IcsShift = { date: string; start: number; end: number; store: string };
export type IcsTask = { id: number; date: string; kind: 'task' | 'note'; title: string; note: string | null; atMin: number | null; done: boolean; mine: boolean };

/** 文字の中の記号を iCalendar の決まりで書き換える */
export function esc(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
/** 1行75バイトまで。超える分は次の行（先頭に空白）へ。日本語の文字の途中では切らない */
export function fold(line: string) {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}
const pad = (n: number) => String(n).padStart(2, '0');
/** 日付＋分（1440以上は翌日）→ 20261111T100000 */
export function local(date: string, min: number) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 0, min));
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00`;
}
const dayOf = (date: string) => date.replace(/-/g, '');
const nextDay = (date: string) => { const [y, m, d] = date.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + 1)); return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`; };
const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const hm = (min: number) => `${Math.floor(min / 60)}:${pad(min % 60)}`;

export function buildIcs(o: { staffId: number; name: string; shifts: IcsShift[]; tasks: IcsTask[]; now: Date; host: string }): string {
  const L: string[] = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Carp Agency//carp-kintai//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`カープ勤怠（${o.name}）`)}`, 'X-WR-TIMEZONE:Asia/Tokyo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Tokyo', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:JST', 'END:STANDARD', 'END:VTIMEZONE',
  ];
  const ds = stamp(o.now);
  const uid = (k: string) => `${k}@${o.host}`;

  for (const s of o.shifts) {
    L.push('BEGIN:VEVENT', `UID:${uid(`shift-${o.staffId}-${s.date}`)}`, `DTSTAMP:${ds}`,
      `DTSTART;TZID=Asia/Tokyo:${local(s.date, s.start)}`, `DTEND;TZID=Asia/Tokyo:${local(s.date, s.end)}`,
      `SUMMARY:${esc(`シフト（${s.store}）`)}`, `LOCATION:${esc(s.store)}`,
      `DESCRIPTION:${esc(`${hm(s.start)}〜${hm(s.end)}　カープ勤怠のシフト（公開済み）`)}`, 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  // 時刻のある予定は1件ずつ（30分）
  for (const t of o.tasks.filter((x) => x.atMin !== null)) {
    const label = `${t.kind === 'note' ? '予定' : '作業'}：${t.title}${t.done ? '（済）' : ''}`;
    L.push('BEGIN:VEVENT', `UID:${uid(`task-${t.id}-${o.staffId}`)}`, `DTSTAMP:${ds}`,
      `DTSTART;TZID=Asia/Tokyo:${local(t.date, t.atMin!)}`, 'DURATION:PT30M', `SUMMARY:${esc(label)}`,
      ...(t.note ? [`DESCRIPTION:${esc(t.note)}`] : []), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  // 時刻のない予定は、その日の終日の予定1件にまとめる（カレンダーが作業で埋まらないように）
  const days = [...new Set(o.tasks.filter((x) => x.atMin === null).map((x) => x.date))].sort();
  for (const d of days) {
    const ts = o.tasks.filter((x) => x.atMin === null && x.date === d);
    const summary = ts.length === 1 ? `${ts[0].kind === 'note' ? '予定' : '作業'}：${ts[0].title}${ts[0].done ? '（済）' : ''}` : `予定表 ${ts.length}件`;
    const desc = ts.map((t) => `・${t.title}${t.mine ? '' : '（全体）'}${t.done ? '（済）' : ''}${t.note ? `\n　${t.note}` : ''}`).join('\n');
    L.push('BEGIN:VEVENT', `UID:${uid(`tasks-${o.staffId}-${d}`)}`, `DTSTAMP:${ds}`,
      `DTSTART;VALUE=DATE:${dayOf(d)}`, `DTEND;VALUE=DATE:${nextDay(d)}`, `SUMMARY:${esc(summary)}`, `DESCRIPTION:${esc(desc)}`,
      'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
