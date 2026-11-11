'use client';
import { newCalTokenAction, dropCalTokenAction } from '@/app/actions';
import { ActionButton } from '@/components/ActionButton';
import { useToast } from '@/components/Toast';

/** 自分のカレンダー（Google・iPhone）に、シフトと予定表を自動で入れる */
export function CalLink({ url }: { url: string | null }) {
  const [toast, node] = useToast();
  if (!url) {
    return (
      <div className="card">
        <b>自分のカレンダーに自動で入れる</b>
        <p className="sub" style={{ margin: '4px 0 10px' }}>
          シフト（公開されたもの）と予定表が、Googleカレンダーやスマホのカレンダーに自動で入ります。最初に1回だけ登録すれば、あとは新しいシフトや予定も自動で増えます。
        </p>
        <ActionButton className="btn primary" action={newCalTokenAction}>カレンダー用のURLを作る</ActionButton>
      </div>
    );
  }
  const webcal = url.replace(/^https?:/, 'webcal:');
  const google = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`;
  return (
    <div className="card cal-card">
      <b>自分のカレンダーに自動で入れる</b>
      <p className="sub" style={{ margin: '4px 0 10px' }}>使っているカレンダーのボタンを押して、追加してください（最初の1回だけ）。</p>
      <div className="cal-btns">
        <a className="btn primary" href={webcal}>iPhoneのカレンダーに追加</a>
        <a className="btn primary" href={google} target="_blank" rel="noopener noreferrer">Googleカレンダーに追加</a>
      </div>
      <ul className="sub cal-notes">
        <li>iPhone：「照会カレンダーを追加しますか？」→「照会」→「追加」</li>
        <li>Googleカレンダー：開いた画面で「追加」。Androidの人もこちら。<b>Googleカレンダーは、シフトの変更が反映されるまで数時間〜半日かかります</b></li>
        <li>TimeTreeの人：上のどちらかで追加してから、TimeTreeのカレンダー設定で、スマホのカレンダー（外部カレンダー）を表示にすると自分の画面に出ます</li>
        <li>入るもの：公開されたシフト、予定表（全体と自分の作業）。時刻のない予定は1日1件にまとめて終日の予定になります</li>
      </ul>
      <details className="cal-more">
        <summary>URLをコピーする・取り消す</summary>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="in" readOnly value={url} aria-label="カレンダー用のURL" style={{ flex: '1 1 200px', minWidth: 0, fontSize: 12 }} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn" type="button" onClick={() => navigator.clipboard?.writeText(url).then(() => toast('コピーしました'), () => toast('コピーできませんでした'))}>コピー</button>
        </div>
        <p className="sub" style={{ margin: '8px 0' }}>このURLを知っている人は、あなたのシフトと予定を見られます。人に送らないでください。間違えて送ったときは作り直してください（前のURLは使えなくなります）。</p>
        <div className="row">
          <ActionButton className="btn" action={newCalTokenAction} confirmText="URLを作り直すと、いま登録しているカレンダーには新しい予定が入らなくなります（追加し直しが必要）。作り直しますか？">作り直す</ActionButton>
          <ActionButton className="btn ghost bad-t" action={dropCalTokenAction} confirmText="URLを取り消しますか？カレンダーに新しい予定が入らなくなります。">取り消す</ActionButton>
        </div>
      </details>
      {node}
    </div>
  );
}
