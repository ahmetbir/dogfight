// MiG-29: long LERX blending into the wing, two engine nacelles under the
// wing roots with wedge intakes, twin fins canted slightly outward.
import { Parts, box, bubble, engine, fin, nose, slab, tube, type Model, type Palette } from "./common.ts";

const CANT = 0.2; // ~11° outward

export function buildMig29(p: Palette): Model {
  const parts = new Parts()
    .add(tube(0.5, 0.6, 5.2), p.body, 0, 0.25, -2.6) // forward fuselage
    .add(nose(0.5, 2.6), p.body, 0, 0.18, -6.5)
    .add(bubble(0.42, 0.55, 1.6), p.canopy, 0, 0.6, -3.6)
    .add(box(1.6, 0.5, 6.4), p.body, 0, 0.2, 2.8) // flat center body between the nacelles
    // Engine nacelles under the wing roots, wedge intakes with dark mouths.
    .mirror(tube(0.62, 0.55, 8.6).translate(1.05, -0.35, 2.6), p.body)
    .mirror(box(0.95, 0.9, 2.2).translate(1.05, -0.45, -2.4), p.body)
    .mirror(box(0.8, 0.75, 0.1).translate(1.05, -0.5, -3.52), p.dark)
    .mirror(tube(0.55, 0.5, 0.8).translate(1.05, -0.35, 7.2), p.dark)
    // LERX: long narrow root extension from the cockpit to the wing.
    .mirror(slab([[0.4, -5.0], [2.1, -0.5], [2.1, 0.8], [0.4, 0.8]], 0.12).translate(0, 0.3, 0), p.body)
    .mirror(slab([[1.8, -0.6], [5.7, 3.0], [5.7, 3.9], [1.8, 3.9]], 0.14), p.body) // wing
    .mirror(slab([[5.3, 2.7], [5.85, 2.9], [5.85, 3.9], [5.3, 3.9]], 0.18), p.stripe) // tip stripe
    .mirror(slab([[1.5, 5.6], [4.1, 7.1], [4.1, 7.7], [1.5, 7.6]], 0.1), p.body) // stabilators
    // Twin fins on the nacelles, canted outward.
    .mirror(fin([[0.2, 3.6], [3.1, 5.8], [3.1, 6.7], [0.2, 6.8]], 0.13, CANT).translate(1.15, 0.1, 0), p.body)
    .mirror(fin([[2.3, 5.2], [3.1, 5.8], [3.1, 6.7], [2.3, 6.77]], 0.17, CANT).translate(1.15, 0.1, 0), p.stripe);
  const body = parts.merge();
  return { body, engines: [engine(1.05, -0.35, 7.6, 0.48), engine(-1.05, -0.35, 7.6, 0.48)], span: 5.85 };
}
