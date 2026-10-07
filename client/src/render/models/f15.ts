// F-15: wide body, box intakes on both sides, large wing, twin upright fins.
import { Parts, box, bubble, engine, fin, nose, slab, tube, type Model, type Palette } from "./common.ts";

export function buildF15(p: Palette): Model {
  const parts = new Parts()
    .add(tube(0.6, 0.65, 3.6), p.body, 0, 0.15, -3.6) // forward fuselage
    .add(nose(0.6, 2.6), p.body, 0, 0.15, -6.7)
    .add(bubble(0.5, 0.6, 1.8), p.canopy, 0, 0.6, -3.7)
    .add(box(2.4, 0.95, 9), p.body, 0, 0, 2.6) // wide center body
    // Box intakes: tall rectangular ducts on both sides, dark square mouths.
    .mirror(box(0.95, 1.25, 4.4).translate(1.55, -0.05, -0.9), p.body)
    .mirror(box(0.8, 1.05, 0.1).translate(1.55, -0.05, -3.12), p.dark)
    .add(tube(0.52, 0.48, 0.9), p.dark, 0.6, 0, 7.4)
    .add(tube(0.52, 0.48, 0.9), p.dark, -0.6, 0, 7.4)
    .mirror(slab([[1.2, -0.4], [6.6, 3.1], [6.6, 4.5], [1.2, 4.6]], 0.16), p.body) // large wing
    .mirror(slab([[6.3, 2.9], [6.75, 3.15], [6.75, 4.5], [6.3, 4.5]], 0.2), p.stripe) // tip stripe
    .mirror(slab([[1.2, 5.8], [4.2, 7.3], [4.2, 8.0], [1.2, 7.9]], 0.1), p.body) // stabilators
    // Twin fins, upright.
    .mirror(fin([[0.45, 4.2], [3.6, 6.4], [3.6, 7.4], [0.45, 7.5]], 0.14).translate(1.05, 0, 0), p.body)
    .mirror(fin([[2.7, 5.8], [3.6, 6.4], [3.6, 7.4], [2.7, 7.47]], 0.18).translate(1.05, 0, 0), p.stripe);
  const body = parts.merge();
  return { body, engines: [engine(0.6, 0, 7.85, 0.46), engine(-0.6, 0, 7.85, 0.46)] };
}
