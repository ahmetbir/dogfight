// F-16: slim fuselage, single chin intake, cropped delta wing, single fin, bubble canopy.
import { Parts, box, bubble, engine, fin, nose, slab, tube, type Model, type Palette } from "./common.ts";

export function buildF16(p: Palette): Model {
  const parts = new Parts()
    .add(tube(0.62, 0.55, 11), p.body, 0, 0, 0.8)
    .add(nose(0.62, 3), p.body, 0, 0, -6.2)
    .add(bubble(0.45, 0.55, 1.7), p.canopy, 0, 0.4, -3.9)
    // Chin intake: box under the fuselage with a dark mouth.
    .add(box(1.05, 0.75, 3.6), p.body, 0, -0.7, -1.4)
    .add(box(0.9, 0.55, 0.1), p.dark, 0, -0.72, -3.22)
    .add(box(0.5, 0.35, 3), p.body, 0, 0.55, 3) // dorsal spine
    .add(tube(0.55, 0.48, 1), p.dark, 0, 0, 6.8) // nozzle
    .mirror(slab([[0.5, -1.2], [4.8, 1.8], [4.8, 2.6], [0.5, 2.8]], 0.14), p.body) // cropped delta
    .mirror(slab([[0.45, -4.2], [1.1, -1.2], [0.5, -1.2]], 0.1), p.body) // small strake
    .mirror(slab([[4.6, 1.5], [4.95, 1.5], [4.95, 2.8], [4.6, 2.75]], 0.18), p.stripe) // tip rails
    .mirror(slab([[0.45, 4.6], [2.9, 6.3], [2.9, 6.9], [0.45, 6.6]], 0.1), p.body) // stabilators
    .add(fin([[0.4, 3.4], [3.3, 5.9], [3.3, 6.8], [0.4, 6.6]], 0.14), p.body)
    .add(fin([[2.5, 5.2], [3.3, 5.9], [3.3, 6.8], [2.5, 6.73]], 0.18), p.stripe);
  const body = parts.merge();
  return { body, engines: [engine(0, 0, 7.3, 0.48)], span: 4.95 };
}
