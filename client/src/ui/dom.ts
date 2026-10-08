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

const NAME_REFUSED = slot("dogfight.nameRefused");

/** The server refused the stored name: forget it and ask again on the next page. */
export function refuseName(): void {
  NAME.set("");
  NAME_REFUSED.set("1");
}

/** Whether the last name was refused (read once: it clears the flag). */
export function takeNameRefused(): boolean {
  const v = NAME_REFUSED.get() === "1";
  if (v) NAME_REFUSED.set("");
  return v;
}
