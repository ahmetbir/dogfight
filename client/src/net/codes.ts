// Stable codes of the server's "notice" messages (internal/protocol codes.go;
// TestNoticeCodesMatchClient keeps the list equal). The core error codes live in roomkit (ts/net/codes.ts).

export { ERROR_CODES, ROOM_GONE, RECOVERABLE, isErrorCode, type ErrorCode } from "roomkit/net/codes";

export const NOTICE_CODES = [
  "team_uneven", "team_full", "team_cooldown", "team_late", "team_locked", "team_hurt", "team_none",
] as const;
export type NoticeCode = (typeof NOTICE_CODES)[number];

export function isNoticeCode(c: unknown): c is NoticeCode {
  return (NOTICE_CODES as readonly unknown[]).includes(c);
}
