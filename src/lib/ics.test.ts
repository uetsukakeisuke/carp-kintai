import { describe, expect, it } from 'vitest';
import { buildIcs, esc, fold, local } from './ics';

const NOW = new Date('2026-11-11T04:00:00Z');
const base = { staffId: 7, name: '見本 太郎', now: NOW, host: 'example.test' };

describe('iCalendar', () => {
  it('記号の書き換え', () => {
    expect(esc('a,b;c\\d\ne')).toBe('a\\,b\;c\\\\d\\ne');
  });
  it('75バイトで折り返し、日本語の途中で切らない', () => {
    const line = 'SUMMARY:' + 'あ'.repeat(60);
    const out = fold(line).split('\r\n');
    expect(out.length).toBeGreaterThan(1);
    for (const l of out) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(out.map((l, i) => (i ? l.slice(1) : l)).join('')).toBe(line);
  });
  it('日付をまたぐシフト（25:00）は翌日に', () => {
    expect(local('2026-11-11', 17 * 60)).toBe('20261111T170000');
    expect(local('2026-11-11', 25 * 60)).toBe('20261112T010000');
    expect(local('2026-12-31', 24 * 60 + 30)).toBe('20270101T003000');
  });
  it('シフト・時刻のある予定・終日にまとめた予定', () => {
    const ics = buildIcs({
      ...base,
      shifts: [{ date: '2026-11-12', start: 600, end: 1020, store: '見本店' }],
      tasks: [
        { id: 1, date: '2026-11-12', kind: 'note', title: '集荷', note: null, atMin: 900, done: false, mine: false },
        { id: 2, date: '2026-11-12', kind: 'task', title: '棚の整理', note: '奥の棚から', atMin: null, done: true, mine: false },
        { id: 3, date: '2026-11-12', kind: 'task', title: '入荷確認', note: null, atMin: null, done: false, mine: true },
      ],
    });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART;TZID=Asia/Tokyo:20261112T100000');
    expect(ics).toContain('DTEND;TZID=Asia/Tokyo:20261112T170000');
    expect(ics).toContain('SUMMARY:予定：集荷');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261112');
    expect(ics).toContain('DTEND;VALUE=DATE:20261113');
    expect(ics).toContain('SUMMARY:予定表 2件');
    expect(ics).toContain('UID:shift-7-2026-11-12@example.test');
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3);
    // 全行が75バイト以内・CRLF
    for (const l of ics.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });
});
