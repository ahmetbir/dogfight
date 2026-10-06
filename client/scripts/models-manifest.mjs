// Writes ../cmd/dogfight/web/models/manifest.json: the aircraft kinds that have
// a static/models/<kind>.glb, so the client never fetches a missing model.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";

const src = new URL("../static/models/", import.meta.url);
const out = new URL("../../cmd/dogfight/web/models/", import.meta.url);

let kinds = [];
try {
  kinds = readdirSync(src).filter((f) => f.endsWith(".glb")).map((f) => f.slice(0, -4)).sort();
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
mkdirSync(out, { recursive: true });
writeFileSync(new URL("manifest.json", out), JSON.stringify(kinds) + "\n");
