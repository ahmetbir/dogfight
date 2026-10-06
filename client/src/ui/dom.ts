// Dogfight's DOM helpers: the core ones plus the stored player name.
import { slot } from "roomkit/store";

export { append, clock, fill, h, text, type Attrs, type Child } from "roomkit/ui/dom";

const NAME = slot("dogfight.name");

export function storedName(): string {
  return NAME.get()?.trim() ?? "";
}

export function storeName(name: string): void {
  NAME.set(name);
}
