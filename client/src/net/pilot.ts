// The pilot token: issued by the server in welcome, kept in localStorage,
// sent back in hello and in the X-Pilot-Token header only (never in URLs).
export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const KEY = "dogfight.pilot";

const storage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage throws on access
  }
};

/** The stored token, "" when absent or invalid. */
export function loadToken(store: Pick<Storage, "getItem"> | null = storage()): string {
  try {
    const t = store?.getItem(KEY) ?? "";
    return TOKEN_RE.test(t) ? t : "";
  } catch {
    return "";
  }
}

/** Stores tok; invalid tokens are ignored. */
export function storeToken(tok: string, store: Pick<Storage, "setItem"> | null = storage()): void {
  if (!TOKEN_RE.test(tok)) return;
  try {
    store?.setItem(KEY, tok);
  } catch {
    // storage blocked: the token lives for this session only
  }
}

