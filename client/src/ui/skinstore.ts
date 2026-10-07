// The paint scheme chosen for each jet, kept in localStorage under one key
// ("dogfight.skins": {kind: id}). A jet never chosen, or a stored id it may
// not wear, gets its default scheme (render/skins.ts).
import { slot, type Store } from "roomkit/store";
import { defaultSkin, validSkin, type SkinId } from "../render/skins.ts";

const SKINS = slot("dogfight.skins");

export class SkinChoices {
  private readonly store: Store | null | undefined;
  private picks: Record<string, string>;

  /** store: the browser's by default (missing or failing: choices last for the page only). */
  constructor(store?: Store | null) {
    this.store = store;
    this.picks = parse(SKINS.get(store));
  }

  /** The scheme kind wears. */
  get(kind: string): SkinId {
    const id = this.picks[kind];
    return id !== undefined && validSkin(kind, id) === id ? (id as SkinId) : defaultSkin(kind);
  }

  /** Chooses id for kind (one it may not wear: standard) and stores every choice. */
  set(kind: string, id: string): SkinId {
    const s = validSkin(kind, id);
    this.picks = { ...this.picks, [kind]: s };
    SKINS.set(JSON.stringify(this.picks), this.store);
    return s;
  }

  /** Each of kinds with its scheme. */
  all(kinds: readonly string[]): Record<string, SkinId> {
    return Object.fromEntries(kinds.map((k) => [k, this.get(k)]));
  }
}

function parse(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return {};
  }
}
