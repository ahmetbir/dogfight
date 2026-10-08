// English: server error and notice codes.
import type { errors as tr } from "../tr/errors.ts";
import type { Area } from "../types.ts";

export const errors: Area<typeof tr> = {
  "err.conn": "Connection error",
  "err.version": "Version mismatch — reload the page",
  "err.no_room": "Room not found",
  "err.bad_room": "Invalid room settings",
  "err.full": "The room is full",
  "err.bad_msg": "Invalid message",
  "err.no_create": "Couldn't create the room",
  "err.busy": "The server is full",
  "err.creates": "Too many rooms created — wait a little",
  "err.joins": "Too many attempts — wait a little",
  "err.flood": "Too many messages",
  "err.conns": "Too many connections",
  "err.timeout": "Timed out",
  "err.updating": "The server is updating — reconnect",
  "err.name_blocked": "This name can't be used — pick another",
  "err.room_gone": "The server was updated and your room closed. Join a new game from the home page.",
  "notice.team_uneven": "The teams would be uneven",
  "notice.team_full": "That team is full",
  "notice.team_cooldown": "Wait {n} s to switch teams",
  "notice.team_late": "No team switching in the round's last {n} s",
  "notice.team_locked": "You can't switch teams while a missile is locked on you",
  "notice.team_hurt": "Wait {n} s after taking damage",
  "notice.team_none": "This mode has no teams",
  "notice.not_host": "Only the host can start the round",
  "notice.not_lobby": "The round has already started",
  "notice.side_full": "No free seat on that side",
  "notice.lobby_closed": "The server is being updated and this lobby closed. Create a new room from the home page and send the link again.",
};
