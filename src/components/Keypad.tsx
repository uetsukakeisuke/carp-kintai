'use client';
// 4桁のパスワード入力（大きなテンキー）
export function Keypad({ value, onChange, onDone, disabled }: { value: string; onChange: (v: string) => void; onDone?: (v: string) => void; disabled?: boolean }) {
  const press = (d: string) => {
    if (disabled) return;
    if (d === 'del') return onChange(value.slice(0, -1));
    if (value.length >= 4) return;
    const v = value + d;
    onChange(v);
    if (v.length === 4) onDone?.(v);
  };
  return (
    <div>
      <div className="pindots" aria-label={`${value.length}桁入力済み`}>{[0, 1, 2, 3].map((i) => <i key={i} className={i < value.length ? 'on' : ''} />)}</div>
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} type="button" onClick={() => press(d)} disabled={disabled}>{d}</button>)}
        <span />
        <button type="button" onClick={() => press('0')} disabled={disabled}>0</button>
        <button type="button" onClick={() => press('del')} disabled={disabled} aria-label="1文字消す">⌫</button>
      </div>
    </div>
  );
}
