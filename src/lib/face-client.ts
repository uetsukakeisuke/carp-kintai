'use client';
// 端末（ブラウザ）の中で顔を見つけ、特徴（128個の数値）を計算する。写真はサーバーに送らない。
type FaceApi = typeof import('@vladmandic/face-api');
let lib: Promise<FaceApi> | null = null;

export let faceBackend = '';
/** iPhone などの実機ではGPU（WebGL）が速い。自動テスト（webdriver）の環境だけ WASM を先に使う */
function backendOrder(): string[] {
  const auto = typeof navigator !== 'undefined' && (navigator as { webdriver?: boolean }).webdriver;
  return auto ? ['wasm', 'webgl', 'cpu'] : ['webgl', 'wasm', 'cpu'];
}
export function loadFace(): Promise<FaceApi> {
  if (!lib) {
    lib = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      const tf = faceapi.tf as unknown as { setWasmPaths?: (p: string) => void; setBackend: (b: string) => Promise<boolean>; ready: () => Promise<void>; getBackend: () => string };
      try { tf.setWasmPaths?.('/face/wasm/'); } catch { /* なし */ }
      for (const b of backendOrder()) {
        try { if (await tf.setBackend(b)) { await tf.ready(); break; } } catch { /* 次を試す */ }
      }
      faceBackend = tf.getBackend();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('/face/models'),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri('/face/models'),
        faceapi.nets.faceRecognitionNet.loadFromUri('/face/models'),
      ]);
      // 最初の1回は準備（GPUの命令の組み立て）に時間がかかるので、空の画像で先に1回動かしておく
      try {
        const c = document.createElement('canvas'); c.width = c.height = 160;
        const g = c.getContext('2d')!; g.fillStyle = '#888'; g.fillRect(0, 0, 160, 160);
        await faceapi.detectAllFaces(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 160 }));
        await faceapi.computeFaceDescriptor(c);
        await faceapi.detectFaceLandmarksTiny(c);
      } catch { /* 準備の失敗は無視 */ }
      return faceapi;
    })().catch((e) => { lib = null; throw e; });
  }
  return lib;
}

export type Describe = { d: number[] } | { err: 'noface' | 'many' };
export async function describeFace(src: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement): Promise<Describe> {
  const fa = await loadFace();
  const dets = await fa.detectAllFaces(src, new fa.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 })).withFaceLandmarks(true).withFaceDescriptors();
  if (!dets.length) return { err: 'noface' };
  if (dets.length > 1) return { err: 'many' };
  return { d: Array.from(dets[0].descriptor).map((x) => Math.round(x * 1e5) / 1e5) };
}

export function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const sc = Math.min(1, 640 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u); res(c);
    };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('img')); };
    img.src = u;
  });
}

export const FACE_ERR: Record<string, string> = {
  noface: '顔が見つかりませんでした。明るい場所で、顔が画面の中央に大きく写るようにしてください。',
  many: '複数の顔が写っています。本人だけが写るようにしてください。',
  load: '顔認証の準備ができませんでした。通信状況を確認してください。',
  camera: 'カメラを使えませんでした。「写真を撮る」から撮影してください。',
};

/**
 * 顔パス用：まず小さく速い探し方で顔の位置と大きさだけを見て、近くに立った人がいるときだけ、
 * その顔の周りを切り出して特徴を計算する（毎回まるごと計算しないので速い）。
 */
export type Detected = { d: number[]; size: number } | { err: 'noface' | 'many' } | { err: 'far'; size: number };
let crop: HTMLCanvasElement | null = null;
export async function detectFace(src: HTMLVideoElement | HTMLCanvasElement, minSize = 0): Promise<Detected> {
  const fa = await loadFace();
  const W = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
  const H = src instanceof HTMLVideoElement ? src.videoHeight : src.height;
  const boxes = await fa.detectAllFaces(src, new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }));
  if (!boxes.length) return { err: 'noface' };
  // 一番大きい顔（いちばん近い人）を使う。同じくらいの大きさの顔が2つあれば判断しない
  const sorted = [...boxes].sort((a, b) => b.box.width - a.box.width);
  if (sorted.length > 1 && sorted[1].box.width > sorted[0].box.width * 0.8) return { err: 'many' };
  const b = sorted[0].box, size = W ? b.width / W : 0;
  if (size < minSize) return { err: 'far', size };
  const m = b.width * 0.4;
  const x = Math.max(0, b.x - m), y = Math.max(0, b.y - m), w = Math.min(W - x, b.width + m * 2), h = Math.min(H - y, b.height + m * 2);
  const sc = Math.min(1, 256 / Math.max(w, h));
  crop = crop ?? document.createElement('canvas');
  crop.width = Math.round(w * sc); crop.height = Math.round(h * sc);
  crop.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, crop.width, crop.height);
  const det = await fa.detectSingleFace(crop, new fa.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.4 })).withFaceLandmarks(true).withFaceDescriptor();
  if (!det) return { err: 'noface' };
  return { d: Array.from(det.descriptor).map((v) => Math.round(v * 1e5) / 1e5), size };
}
