import 'server-only';
import { sql, audit } from './db';

// 顔の照合（サーバー側）。端末で計算した顔の特徴（128個の数値）を、登録済みの特徴と比べる。
// 距離が FACE_THRESHOLD 未満なら本人とみなす（face-api の推奨 0.6 より厳しめ）。
export const FACE_THRESHOLD = 0.5;
export type FaceInput = { d: number[] | null } | undefined;
export type FaceResult = { face: 'ok' | 'mismatch' | 'skipped'; distance: number | null };

export function validDescriptor(d: unknown): d is number[] {
  return Array.isArray(d) && d.length === 128 && d.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 10);
}
export async function hasFace(staffId: number) {
  const [r] = await sql`select 1 from staff_faces where staff_id = ${staffId}`;
  return !!r;
}
export async function faceRegistrations() {
  return sql<{ staff_id: number; created_at: Date }[]>`select staff_id, created_at from staff_faces`;
}
export async function registerFace(actorId: number, staffId: number, d: number[]) {
  await sql`insert into staff_faces (staff_id, descriptor, consent_at, registered_by) values (${staffId}, ${d}, now(), ${actorId})
    on conflict (staff_id) do update set descriptor = excluded.descriptor, consent_at = excluded.consent_at, registered_by = excluded.registered_by, created_at = now()`;
  await audit(actorId, 'face_registered', { staffId });
}
export async function deleteFace(actorId: number, staffId: number) {
  await sql`delete from staff_faces where staff_id = ${staffId}`;
  await audit(actorId, 'face_deleted', { staffId });
}
/** 打刻時の照合。顔が登録されていない人は null（照合しない） */
export async function matchFace(staffId: number, input: FaceInput): Promise<FaceResult | null | 'required'> {
  const [f] = await sql<{ descriptor: number[] }[]>`select descriptor from staff_faces where staff_id = ${staffId}`;
  if (!f) return null;
  if (!input) return 'required';
  if (!input.d) return { face: 'skipped', distance: null };
  if (!validDescriptor(input.d)) return { face: 'skipped', distance: null };
  let s = 0;
  for (let i = 0; i < 128; i++) { const x = input.d[i] - f.descriptor[i]; s += x * x; }
  const distance = Math.round(Math.sqrt(s) * 1000) / 1000;
  return { face: distance < FACE_THRESHOLD ? 'ok' : 'mismatch', distance };
}
