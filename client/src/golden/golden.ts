// Golden fixtures: a test compares its value with <name>.json next to this
// file; UPDATE_GOLDEN=1 writes it instead (Phase 0, Task 4 only).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const dir = new URL(".", import.meta.url);

export function matchFixture(name: string, value: unknown): void {
  const file = new URL(`${name}.json`, dir);
  const text = JSON.stringify(value, null, 1) + "\n";
  if (process.env.UPDATE_GOLDEN === "1") {
    writeFileSync(file, text);
    return;
  }
  assert.ok(existsSync(file), `${name}.json missing: created by Task 4 only`);
  assert.deepStrictEqual(JSON.parse(text), JSON.parse(readFileSync(file, "utf8")));
}
