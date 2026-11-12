// サーバーの処理を安全に呼ぶ（クライアント用）。
// 電波が切れた・サーバーがエラーを返した、などで例外になっても
// 「保存されていない」ことを必ず画面に出せるよう、{ ok: false } に変換する。
export const NET_ERROR = '通信できなかったため、保存されていません。電波の良い場所でもう一度押してください。';
export const SLOW_ERROR = '応答に時間がかかっています。保存できたかどうかは、画面を開き直して確かめてください（同じ打刻を2回押しても二重にはなりません）。';
const LIMIT_MS = 25_000; // これ以上待たせない（ボタンが押せないまま固まらないように）

type Fail = { ok: false; error: string };

export async function call<R>(fn: () => Promise<R>, limitMs = LIMIT_MS): Promise<R | Fail> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const slow = new Promise<Fail>((res) => { timer = setTimeout(() => {
    try { window.dispatchEvent(new Event('kintai-stuck')); } catch { /* なし */ }
    res({ ok: false, error: SLOW_ERROR });
  }, limitMs); });
  try {
    return await Promise.race([fn(), slow]);
  } catch (e) {
    // ログイン後の画面移動など、Next.js 自身の処理は邪魔しない
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === 'string' && digest.startsWith('NEXT_')) throw e;
    console.error(e);
    return { ok: false, error: NET_ERROR };
  } finally {
    clearTimeout(timer);
  }
}

/** 時間切れで打ち切ったか（このあと画面の読み直しを頼むと、止まっている処理を待ってボタンが押せないままになるので頼まない） */
export const timedOut = (r: unknown) => !!r && typeof r === 'object' && (r as Fail).ok === false && (r as Fail).error === SLOW_ERROR;
