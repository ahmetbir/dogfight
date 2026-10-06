// Port of internal/bot/autopilot.go Steer.
import { norm, qConj, qRotate, type Q, type V3 } from "./vec.ts";

const clamp = (x: number) => Math.max(-1, Math.min(1, x));

// Gains (stick per rad; roll damping per rad/s), as in autopilot.go.
const GAIN_FINE = 8, GAIN_PULL = 3.5, GAIN_ROLL = 2, GAIN_D_ROLL = 0.1;

/** Stick commands that turn the nose of rot (body angular rate w) toward world direction dir. */
export function steer(rot: Q, w: V3 | undefined, dir: V3): { p: number; r: number; y: number } {
  const wz = w?.z ?? 0;
  const l = qRotate(qConj(rot), norm(dir)); // local: forward = -Z
  const off = Math.acos(Math.max(-1, Math.min(1, -l.z)));
  if (off < 0.08) { // nearly on the nose: fine-tune with pitch and yaw, keep wings level
    return { p: clamp(l.y * GAIN_FINE), r: 0, y: clamp(l.x * GAIN_FINE) };
  }
  const bank = Math.atan2(l.x, l.y); // 0 = target straight "above" the canopy
  if (Math.abs(bank) > 2.4) { // target below: push instead of rolling inverted
    return { p: clamp(-off * 2), r: clamp((bank - Math.sign(bank) * Math.PI) * GAIN_ROLL + wz * GAIN_D_ROLL), y: 0 };
  }
  let pull = off * GAIN_PULL;
  if (Math.abs(bank) > 0.6) pull *= 0.3; // roll first, then pull
  return { p: clamp(pull), r: clamp(bank * GAIN_ROLL + wz * GAIN_D_ROLL), y: 0 };
}
