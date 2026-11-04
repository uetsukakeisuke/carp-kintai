'use client';
// 端末（ブラウザ）の中で顔を見つけ、特徴（128個の数値）を計算する。写真はサーバーに送らない。
type FaceApi = typeof import('@vladmandic/face-api');
let lib: Promise<FaceApi> | null = null;

export function loadFace(): Promise<FaceApi> {
  if (!lib) {
    lib = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      const tf = faceapi.tf as unknown as { setWasmPaths?: (p: string) => void; setBackend: (b: string) => Promise<boolean>; ready: () => Promise<void> };
      let ok = false;
      try { tf.setWasmPaths?.('/face/wasm/'); ok = await tf.setBackend('wasm'); } catch { ok = false; }
      if (!ok) { try { ok = await tf.setBackend('webgl'); } catch { ok = false; } }
      if (!ok) await tf.setBackend('cpu');
      await tf.ready();
      await faceapi.nets.tinyFaceDetector.loadFromUri('/face/models');
      await faceapi.nets.faceLandmark68TinyNet.loadFromUri('/face/models');
      await faceapi.nets.faceRecognitionNet.loadFromUri('/face/models');
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

/** 顔パス用：顔を1つ見つけ、特徴と「画面に対する顔の大きさ」を返す（遠くを通る人を除くため） */
export type Detected = { d: number[]; size: number } | { err: 'noface' | 'many' };
export async function detectFace(src: HTMLVideoElement | HTMLCanvasElement): Promise<Detected> {
  const fa = await loadFace();
  const W = src instanceof HTMLVideoElement ? src.videoWidth : src.width;
  const dets = await fa.detectAllFaces(src, new fa.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 })).withFaceLandmarks(true).withFaceDescriptors();
  if (!dets.length) return { err: 'noface' };
  // 一番大きい顔（いちばん近い人）を使う。同じくらいの大きさの顔が2つあれば判断しない
  const sorted = [...dets].sort((a, b) => b.detection.box.width - a.detection.box.width);
  if (sorted.length > 1 && sorted[1].detection.box.width > sorted[0].detection.box.width * 0.8) return { err: 'many' };
  const top = sorted[0];
  return { d: Array.from(top.descriptor).map((x) => Math.round(x * 1e5) / 1e5), size: W ? top.detection.box.width / W : 0 };
}
