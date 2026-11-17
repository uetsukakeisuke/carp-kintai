import 'server-only';
import { sql } from './db';
import { jstParts } from './time';
import { buildReport, type Cell, type OrderRow } from './kobo';
import { dayLoads } from './forecast';
import { forecastParams } from './forecast-data';
import { briefOf, type DayBrief } from './brief';

// 台帳は大きいので、同じ台帳・同じ日のあいだは組み立てた結果を使い回す（打刻画面を遅くしないため）
let memo: { key: string; at: Date; byDate: Map<string, DayBrief> } | null = null;

/**
 * 受発注台帳から、日ごとの入荷・出荷（スタッフに見せてよい項目だけ）。
 * 台帳がまだ届いていない・読めないときは null（画面はこの欄を出さないだけ）。
 */
export async function ledgerBrief(): Promise<{ at: Date; byDate: Map<string, DayBrief> } | null> {
  try {
    const today = jstParts().date;
    const [[head], { params }] = await Promise.all([
      sql<{ id: string | number; received_at: Date }[]>`select id, received_at from ledger_snapshots order by id desc limit 1`,
      forecastParams(),
    ]);
    if (!head) return null;
    const key = `${head.id}|${today}|${params.shipLead}`;
    if (memo?.key === key) return memo;
    // 取り込むときに残した「まだ済になっていない行」だけを読む（台帳全体は大きいので）。古い台帳にはないので全体から作る
    const [snap] = await sql<{ open: OrderRow[] | null }[]>`select meta->'open' as open from ledger_snapshots where id = ${head.id}`;
    let rows: OrderRow[];
    if (Array.isArray(snap?.open)) rows = snap.open;
    else {
      const [full] = await sql<{ orders: Cell[][] }[]>`select orders from ledger_snapshots where id = ${head.id}`;
      if (!full) return null;
      rows = buildReport(full.orders, [], today).rows;
    }
    const loads = dayLoads(rows, today, params.shipLead, { keepEmpty: true });
    const byDate = new Map<string, DayBrief>();
    for (const [d, l] of loads) if (d >= today) byDate.set(d, briefOf(l.items));
    memo = { key, at: new Date(head.received_at), byDate };
    return memo;
  } catch {
    return null;
  }
}
