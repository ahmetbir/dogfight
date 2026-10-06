// Su-27: long flat fuselage, long drooped nose, big LERX, widely spaced
// nacelles, twin upright fins and a central tail sting.
import { Parts, box, bubble, engine, fin, nose, slab, tube, type Model, type Palette } from "./common.ts";

export function buildSu27(p: Palette): Model {
  const parts = new Parts()
    .add(tube(0.5, 0.62, 5.6).scale(1, 0.85, 1), p.body, 0, 0.2, -3.2) // forward fuselage
    .add(nose(0.5, 3.6).scale(1, 0.85, 1), p.body, 0, 0.12, -7.8) // long nose
    .add(bubble(0.42, 0.55, 1.7), p.canopy, 0, 0.55, -4.3)
    .add(box(1.9, 0.42, 7.6), p.body, 0, 0.15, 2.4) // flat center body
    // Nacelles, spaced wide, with rectangular intakes under the LERX.
    .mirror(tube(0.62, 0.55, 8.6).scale(1, 0.85, 1).translate(1.25, -0.3, 2.3), p.body)
    .mirror(box(1.0, 0.85, 2.4).translate(1.25, -0.42, -2.8), p.body)
    .mirror(box(0.85, 0.7, 0.1).translate(1.25, -0.45, -4.02), p.dark)
    .mirror(tube(0.55, 0.5, 0.8).translate(1.25, -0.3, 6.9), p.dark)
    // Big LERX sweeping from the cockpit into the wing.
    .mirror(slab([[0.4, -6.2], [2.6, -0.7], [2.6, 0.8], [0.4, 0.8]], 0.12).translate(0, 0.28, 0), p.body)
    .mirror(slab([[2.3, -0.8], [6.9, 3.0], [6.9, 3.9], [2.3, 3.9]], 0.14), p.body) // wing
    .mirror(slab([[6.5, 2.7], [7.05, 2.9], [7.05, 3.9], [6.5, 3.9]], 0.18), p.stripe) // tip stripe
    .mirror(slab([[1.8, 5.6], [4.8, 7.2], [4.8, 7.9], [1.8, 7.7]], 0.1), p.body) // stabilators
    // Twin upright fins on the outer booms.
    .mirror(fin([[0.15, 3.5], [3.3, 5.8], [3.3, 6.7], [0.15, 6.9]], 0.13).translate(1.75, 0.05, 0), p.body)
    .mirror(fin([[2.45, 5.2], [3.3, 5.8], [3.3, 6.7], [2.45, 6.76]], 0.17).translate(1.75, 0.05, 0), p.stripe)
    // Tail sting between the engines.
    .add(tube(0.4, 0.25, 2.6), p.body, 0, 0.1, 7.1)
    .add(nose(0.25, 1.2).rotateX(Math.PI), p.dark, 0, 0.1, 9.0);
  const body = parts.merge();
  return { body, engines: [engine(1.25, -0.3, 7.3, 0.48), engine(-1.25, -0.3, 7.3, 0.48)], span: 7.05 };
}
