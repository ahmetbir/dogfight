// Dogfight's DOM helpers: the core ones plus the stored player name.
import { slot } from "../core/store.ts";

export { append, clock, fill, h, text, type Attrs, type Child } from "../core/ui/dom.ts";

const NAME = slot("dogfight.name");

export function storedName(): string {
  return NAME.get()?.trim() ?? "";
}

export function storeName(name: string): void {
  NAME.set(name);
}
