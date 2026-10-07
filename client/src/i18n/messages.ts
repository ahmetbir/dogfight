// Server error / notice codes → dictionary keys. A message without a known
// code (an older server) falls back to its own text.
import { ROOM_GONE, isErrorCode, isNoticeCode, type ErrorCode, type NoticeCode } from "../net/codes.ts";
import { t, type Key, type Params } from "./index.ts";

export const ERROR_KEY: Record<ErrorCode | typeof ROOM_GONE, Key> = {
  version: "err.version", no_room: "err.no_room", bad_room: "err.bad_room", full: "err.full", bad_msg: "err.bad_msg",
  no_create: "err.no_create", busy: "err.busy", creates: "err.creates", joins: "err.joins", flood: "err.flood",
  conns: "err.conns", timeout: "err.timeout", updating: "err.updating", room_gone: "err.room_gone",
};

export const NOTICE_KEY: Record<NoticeCode, Key> = {
  team_uneven: "notice.team_uneven", team_full: "notice.team_full", team_cooldown: "notice.team_cooldown",
  team_late: "notice.team_late", team_locked: "notice.team_locked", team_hurt: "notice.team_hurt", team_none: "notice.team_none",
  not_host: "notice.not_host", not_lobby: "notice.not_lobby", side_full: "notice.side_full",
};

/** A fatal server error in the current language. */
export function errorText(code: string | undefined, msg: string): string {
  if (code === ROOM_GONE || isErrorCode(code)) return t(ERROR_KEY[code]);
  return msg || t("err.conn");
}

/** A server notice in the current language; params fill its numbers (cooldowns). */
export function noticeText(code: string | undefined, msg: string, params?: Params): string {
  return isNoticeCode(code) ? t(NOTICE_KEY[code], params) : msg;
}
