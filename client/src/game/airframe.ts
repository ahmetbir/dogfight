// Each kind's airframe in metres, as the server's sim.Spec has it (pinned by
// internal/match/book_rules_test.go through RULES), and what follows from it
// on the client: where rounds leave the gun, how far back the chase camera rides.
import { RULES } from "../book/rules.ts";

export type Airframe = {
  length: number; span: number;
  nose: number;   // ahead of the origin
  muzzle: number; // where a round leaves the gun, ahead of the origin (sim.Spec.Muzzle)
};

const rules = RULES as Readonly<Record<string, number>>;

/** The airframe of kind; an unknown kind gets the F-16's. */
export function airframe(kind: string): Airframe {
  const k = rules[`${kind}Length`] === undefined ? "f16" : kind;
  const nose = rules[`${k}Nose`];
  return { length: rules[`${k}Length`], span: rules[`${k}Span`], nose, muzzle: nose + RULES.muzzleLead };
}
