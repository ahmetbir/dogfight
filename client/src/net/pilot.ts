import { slot } from "../core/store.ts";
import { tokenStore } from "../core/net/pilot.ts";

export { TOKEN_RE } from "../core/net/pilot.ts";

const tokens = tokenStore(slot("dogfight.pilot"));

/** The stored token, "" when absent or invalid. */
export const loadToken = (store?: Pick<Storage, "getItem"> | null): string => tokens.load(store);
/** Stores tok; invalid tokens are ignored. */
export const storeToken = (tok: string, store?: Pick<Storage, "setItem"> | null): void => tokens.save(tok, store);
