// サーバーの処理を安全に呼ぶ（クライアント用）。
// 電波が切れた・サーバーがエラーを返した、などで例外になっても
// 「保存されていない」ことを必ず画面に出せるよう、{ ok: false } に変換する。
export const NET_ERROR = '通信できなかったため、保存されていません。電波の良い場所でもう一度押してください。';

type Fail = { ok: false; error: string };

export async function call<R>(fn: () => Promise<R>): Promise<R | Fail> {
  try {
    return await fn();
  } catch (e) {
    // ログイン後の画面移動など、Next.js 自身の処理は邪魔しない
    const digest = (e as { digest?: unknown } | null)?.digest;
    if (typeof digest === 'string' && digest.startsWith('NEXT_')) throw e;
    console.error(e);
    return { ok: false, error: NET_ERROR };
  }
}
