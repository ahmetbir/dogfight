// The pilot's manual in one language: the prose of every chapter, split in
// three parts. Each language annotates its parts with these types, so a
// missing or an extra chapter fails to compile.
import type { ChapterBody } from "../../book/kit.ts";

export type Basics = { readonly start: ChapterBody; readonly controls: ChapterBody; readonly flight: ChapterBody; readonly aircraft: ChapterBody };
export type Combat = { readonly ground: ChapterBody; readonly weapons: ChapterBody; readonly modes: ChapterBody };
export type Field = { readonly world: ChapterBody; readonly hud: ChapterBody; readonly tips: ChapterBody };
export type BookText = Basics & Combat & Field;
export type ChapterName = keyof BookText;
