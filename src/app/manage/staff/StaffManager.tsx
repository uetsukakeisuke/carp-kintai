'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { saveStaffAction, addWageAction, resetPinAction, raiseToMinWageAction, type StaffInput } from '@/app/actions';
import { useToast } from '@/components/Toast';
import { call } from '@/lib/call';

type S = {
  id: number; name: string; kana: string; role: 'staff' | 'manager' | 'admin'; employment: string; payType: string; storeId: number | null;
  transport: number; commuteMeans: string; active: boolean; mustChange: boolean; locked: boolean; wage: number | null;
  future: { effective_from: string; hourly: number }[]; history: { effective_from: string; hourly: number }[]; belowNow: boolean; belowNext: boolean;
};
const yen = (n: number | null) => (n === null ? '—' : '¥' + n.toLocaleString('ja-JP'));
const ROLE = { staff: 'スタッフ', manager: '店長', admin: '管理者' };
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

export function StaffManager({ staff, stores, minWage, today, isAdmin, showAll }: {
  staff: S[]; stores: { id: number; name: string }[]; minWage: { now: number; next: { effective_from: string; hourly: number } | null }; today: string; isAdmin: boolean; showAll: boolean;
}) {
  const router = useRouter();
  const [toast, node] = useToast();
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<(StaffInput & { id: number | null; active: boolean }) | null>(null);
  const [wage, setWage] = useState<{ s: S; from: string; hourly: number } | null>(null);
  const [err, setErr] = useState('');
  const low = staff.filter((s) => s.active && (s.belowNow || s.belowNext));
  const run = (f: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, close: () => void) => start(async () => {
    setErr('');
    const r = await call(f);
    if (!r.ok) { setErr(r.error); return; }
    close(); toast(r.message ?? '保存しました'); router.refresh();
  });
  const storeName = (id: number | null) => stores.find((s) => s.id === id)?.name ?? '—';

  return (
    <>
      <div className={`banner${low.length ? ' warn' : ''}`}>
        <span>
          <b>京都府の最低賃金：{yen(minWage.now)}</b>
          {minWage.next && <>　{md(minWage.next.effective_from)}から <b>{yen(minWage.next.hourly)}</b> に上がります。</>}
          {low.length > 0 && <b className="bad-t">　{low.length}名の時給が最低賃金を下回っています（予定を含む）。</b>}
        </span>
        {low.length > 0 && minWage.next && (
          <button className="btn primary" disabled={pending} onClick={() => run(() => raiseToMinWageAction(minWage.next!.effective_from, minWage.next!.hourly, low.map((s) => s.id)), () => {})}>
            {low.length}名を {md(minWage.next.effective_from)} から{yen(minWage.next.hourly)}に引き上げ
          </button>
        )}
      </div>
      <div className="row" style={{ marginBottom: 10, justifyContent: 'space-between' }}>
        <button className="btn primary" onClick={() => { setErr(''); setEdit({ id: null, name: '', kana: '', storeId: stores[0]?.id ?? null, employment: 'ﾊﾟｰﾄ', transport: 0, commuteMeans: '電車', hourly: minWage.next && today >= minWage.next.effective_from ? minWage.next.hourly : Math.max(minWage.now, 1200), wageFrom: today, active: true, role: 'staff' }); }}>スタッフを追加</button>
        <Link className="btn ghost" href={showAll ? '/manage/staff' : '/manage/staff?all=1'}>{showAll ? '在籍中だけ表示' : '退職者も表示'}</Link>
      </div>
      <div className="grid-wrap"><table className="tbl stack" style={{ minWidth: 820 }}>
        <thead><tr><th>スタッフ</th><th>所属</th><th>権限</th><th>現在の時給</th><th>予定の改定</th><th>交通費／日</th><th>ログイン</th><th></th></tr></thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.id} style={s.active ? undefined : { opacity: .55 }}>
              <td className="head"><b>{s.name}</b>{!s.active && <span className="flag">退職</span>}<span className="sub" style={{ marginLeft: 8 }}>{s.employment}</span></td>
              <td data-label="所属"><span>{storeName(s.storeId)}<span className="sub sp-only" style={{ marginLeft: 6 }}>（{ROLE[s.role]}）</span></span></td>
              <td data-label="権限" className="hide-sp">{ROLE[s.role]}</td>
              <td data-label="現在の時給" className="num">{s.payType === 'monthly' ? '月給' : yen(s.wage)}{s.belowNow && <span className="flag f-late">最低賃金未満</span>}</td>
              <td data-label="予定の改定" className={`num${s.future.length || s.belowNext ? '' : ' hide-sp'}`}>{s.future.map((f) => `${md(f.effective_from)}〜${yen(f.hourly)}`).join('、') || '—'}{s.belowNext && !s.belowNow && <span className="flag f-late">{minWage.next && md(minWage.next.effective_from)}以降 最低賃金未満</span>}</td>
              <td data-label="交通費／日" className={`num${s.transport ? '' : ' hide-sp'}`}>{yen(s.transport)}</td>
              <td data-label="ログイン" className={s.role === 'staff' ? 'hide-sp' : ''}>{s.role === 'staff' ? <span className="sub">名前だけ</span> : s.locked ? <span className="stt s-missing">ロック中</span> : s.mustChange ? <span className="stt">初期（1111）</span> : <span className="stt s-done">パスワード設定済み</span>}</td>
              <td className="acts" style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                {s.payType === 'hourly' && <button className="btn" onClick={() => { setErr(''); setWage({ s, from: today, hourly: s.wage ?? minWage.now }); }}>時給</button>}{' '}
                <button className="btn" onClick={() => { setErr(''); setEdit({ id: s.id, name: s.name, kana: s.kana, storeId: s.storeId, employment: s.employment, transport: s.transport, commuteMeans: s.commuteMeans, role: s.role, active: s.active }); }}>編集</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p className="sub" style={{ marginTop: 12 }}>時給は「いつから適用するか」を指定して変更します。それより前の勤務は元の時給のまま計算され、変更の履歴も残ります。</p>

      {wage && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && setWage(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="wt">
            <h3 id="wt">{wage.s.name} の時給</h3>
            <p className="meta">現在 {yen(wage.s.wage)}</p>
            <div className="formgrid">
              <label htmlFor="wh">新しい時給（円）</label><input id="wh" className="in num" type="number" inputMode="numeric" min={0} step={10} value={wage.hourly} onChange={(e) => setWage({ ...wage, hourly: Math.round(Number(e.target.value) || 0) })} />
              <label htmlFor="wf">適用開始日</label><input id="wf" className="in" type="date" value={wage.from} onChange={(e) => setWage({ ...wage, from: e.target.value })} />
            </div>
            {wage.s.history.length > 0 && <p className="sub">履歴：{wage.s.history.map((h) => `${h.effective_from} から ${yen(h.hourly)}`).join(' ／ ')}</p>}
            {err && <p className="err">{err}</p>}
            <div className="actions"><button className="btn" onClick={() => setWage(null)}>キャンセル</button>
              <button className="btn primary" disabled={pending} onClick={() => run(() => addWageAction(wage.s.id, wage.from, wage.hourly), () => setWage(null))}>保存する</button></div>
          </div>
        </div>
      )}

      {edit && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && setEdit(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="et">
            <h3 id="et">{edit.id === null ? 'スタッフを追加' : `${edit.name} の情報`}</h3>
            <p className="meta">{edit.id === null ? '登録すると、ログイン画面で名前を押すだけで使えます。店長・管理者にした場合は初期パスワード 1111 でログインします。' : ''}</p>
            <div className="formgrid">
              <label htmlFor="en">氏名</label><input id="en" className="in" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              <label htmlFor="ek">ふりがな</label><input id="ek" className="in" value={edit.kana} onChange={(e) => setEdit({ ...edit, kana: e.target.value })} />
              <label htmlFor="es">所属</label><select id="es" className="sel" value={edit.storeId ?? ''} onChange={(e) => setEdit({ ...edit, storeId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">（なし）</option>{stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <label htmlFor="ee">雇用</label><select id="ee" className="sel" value={edit.employment} onChange={(e) => setEdit({ ...edit, employment: e.target.value })}>
                {['ﾊﾟｰﾄ', 'ｱﾙﾊﾞｲﾄ', '社員', '役員'].map((x) => <option key={x}>{x}</option>)}</select>
              {isAdmin && <><label htmlFor="er">権限</label><select id="er" className="sel" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as S['role'] })}>
                {(['staff', 'manager', 'admin'] as const).map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</select></>}
              <label htmlFor="et2">交通費／日（円）</label><input id="et2" className="in num" type="number" min={0} step={10} value={edit.transport} onChange={(e) => setEdit({ ...edit, transport: Number(e.target.value) || 0 })} />
              <label htmlFor="ec">通勤手段</label><input id="ec" className="in" value={edit.commuteMeans} onChange={(e) => setEdit({ ...edit, commuteMeans: e.target.value })} placeholder="電車" />
              {edit.id === null && <>
                <label htmlFor="eh">時給（円）</label><input id="eh" className="in num" type="number" min={0} step={10} value={edit.hourly ?? 0} onChange={(e) => setEdit({ ...edit, hourly: Number(e.target.value) || 0 })} />
                <label htmlFor="ef">時給の適用開始日</label><input id="ef" className="in" type="date" value={edit.wageFrom} onChange={(e) => setEdit({ ...edit, wageFrom: e.target.value })} />
              </>}
            </div>
            {err && <p className="err">{err}</p>}
            <div className="actions">
              {edit.id !== null && <>
                {edit.role !== 'staff' && <button className="btn left" disabled={pending} onClick={() => run(() => resetPinAction(edit.id!), () => setEdit(null))}>パスワードを1111に戻す</button>}
                <button className="btn danger" disabled={pending} onClick={() => run(() => saveStaffAction(edit.id, { ...edit, active: !edit.active }), () => setEdit(null))}>{edit.active ? '退職にする' : '在籍に戻す'}</button>
              </>}
              <button className="btn" onClick={() => setEdit(null)}>キャンセル</button>
              <button className="btn primary" disabled={pending} onClick={() => run(() => saveStaffAction(edit.id, edit), () => setEdit(null))}>保存する</button>
            </div>
          </div>
        </div>
      )}
      {node}
    </>
  );
}
