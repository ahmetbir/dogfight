import { slot } from "roomkit/store";
import { tokenStore } from "roomkit/net/pilot";

export { TOKEN_RE } from "roomkit/net/pilot";

const tokens = tokenStore(slot("dogfight.pilot"));

/** The stored token, "" when absent or invalid. */
export const loadToken = (store?: Pick<Storage, "getItem"> | null): string => tokens.load(store);
/** Stores tok; invalid tokens are ignored. */
export const storeToken = (tok: string, store?: Pick<Storage, "setItem"> | null): void => tokens.save(tok, store);
