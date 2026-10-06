// Stable codes of the server's "error" and "notice" messages (internal/protocol
// codes.go; TestCodesMatchClient keeps the lists equal). The client shows the
// text of the code in its own language; the message's msg is a fallback.

export const ERROR_CODES = [
  "version", "no_room", "bad_room", "full", "bad_msg", "no_create", "busy", "creates", "joins", "flood", "conns", "timeout", "updating",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const NOTICE_CODES = [
  "team_uneven", "team_full", "team_cooldown", "team_late", "team_locked", "team_hurt", "team_none",
] as const;
export type NoticeCode = (typeof NOTICE_CODES)[number];

/** The client's own code for "no_room" right after a server update (the room was lost to it). */
export const ROOM_GONE = "room_gone";

/** Errors that end only this connection (the server's flood kick): the socket reconnects instead of giving up. */
export const RECOVERABLE = new Set(["flood"]);

export function isErrorCode(c: unknown): c is ErrorCode {
  return (ERROR_CODES as readonly unknown[]).includes(c);
}

export function isNoticeCode(c: unknown): c is NoticeCode {
  return (NOTICE_CODES as readonly unknown[]).includes(c);
}
