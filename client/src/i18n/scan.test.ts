import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// No user-visible Turkish outside the dictionaries: every source file under
// client/src (tests aside: they assert the Turkish output on purpose) must be
// free of Turkish-only letters except inside comments and i18n/.

const SRC = new URL("..", import.meta.url).pathname;
const TURKISH = /[çğıİöşüÇĞÖŞÜ]/;

/** Files allowed to carry Turkish letters in code, with the reason. Keep it empty if at all possible. */
const ALLOW: Record<string, string> = {};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return relative(SRC, p) === "i18n" ? [] : sources(p);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
  });
}

/** The source with every comment blanked out (strings, template literals and regexes are kept). */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let quote = "";
  while (i < src.length) {
    const c = src[i]!, n = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") { out += n ?? ""; i += 2; continue; }
      if (c === quote) quote = "";
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    out += c;
    i++;
  }
  return out;
}

test("the comment stripper keeps strings and drops comments", () => {
  assert.equal(stripComments(`a = "x // y"; // ç\nb = 'ş'; /* ğ\n ü */ c`).includes("ç"), false);
  assert.ok(stripComments(`b = 'ş';`).includes("ş"));
  assert.ok(stripComments("u = `İ ${x}`;").includes("İ"));
  assert.ok(!stripComments("/** ö */ x").includes("ö"));
});

test("no Turkish text in client/src outside i18n/ (comments aside)", () => {
  const hits: string[] = [];
  for (const f of sources(SRC)) {
    const rel = relative(SRC, f);
    if (rel in ALLOW) continue;
    stripComments(readFileSync(f, "utf8")).split("\n").forEach((line, i) => {
      if (TURKISH.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], "move these texts into the i18n dictionaries");
});
