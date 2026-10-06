// Port of internal/sim/wind.go (WindAt); flight.json pins it.
import { add, norm, scale, v3, type V3 } from "./vec.ts";
import { DT } from "./flight.ts";

/** Wind at tick: base wind plus a deterministic gust along and across it. */
export function windAt(base: V3, gust: number, tick: number): V3 {
  if (gust === 0) return base;
  const t = tick * DT;
  const along = gust * (0.6 * Math.sin(2 * Math.PI * t / 7.3) + 0.4 * Math.sin(2 * Math.PI * t / 2.9 + 1.3));
  const cross = 0.5 * gust * Math.sin(2 * Math.PI * t / 5.1 + 0.7);
  const d = norm(base);
  const side = v3(-d.z, 0, d.x);
  return add(add(base, scale(d, along)), scale(side, cross));
}
