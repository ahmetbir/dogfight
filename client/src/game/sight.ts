// What a pilot can make out of enemy planes (feedback #1 item 13): name tags
// up close or near the gun line, radar blips only nearby. Cosmetic: the
// server still sends every plane.
import { dist, dot, norm, sub, type V3 } from "../sim/vec.ts";

export const TAG_NEAR_M = 1200;                // enemy tag always within this range
export const TAG_GUN_M = 3000;                 // ...or within this range near the gun line
export const TAG_GUN_RAD = (8 * Math.PI) / 180;
export const RADAR_ENEMY_M = 2500;             // enemy blips within this range

/** Whether an enemy at p shows its name tag to me (my position and nose; null while dead: from the camera). */
export function enemyTagVisible(me: { pos: V3; fwd: V3 } | null, cam: V3, p: V3): boolean {
  const from = me?.pos ?? cam;
  const d = dist(from, p);
  if (d <= TAG_NEAR_M) return true;
  if (!me || d >= TAG_GUN_M || d < 1e-6) return false;
  return dot(norm(sub(p, me.pos)), me.fwd) >= Math.cos(TAG_GUN_RAD);
}

/** Whether an enemy at p shows on my radar. */
export function enemyOnRadar(me: V3, p: V3): boolean {
  return dist(me, p) <= RADAR_ENEMY_M;
}
