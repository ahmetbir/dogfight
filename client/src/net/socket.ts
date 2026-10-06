// Dogfight's socket: the core socket with Dogfight's messages, version and shaping.
import { Socket as CoreSocket, type Env, type Handlers, type Join, type Quick } from "../core/net/socket.ts";
import { VERSION, type ClientMsg, type Create, type ServerMsg } from "./protocol.ts";
import { POLICY } from "./shaper.ts";

export { socketURL, RECONNECT_MS, FIRST_TRIES, PING_MS, CLOSE_RESTART, type Conn, type Env, type Status } from "../core/net/socket.ts";
export type Socket = CoreSocket<ClientMsg, ServerMsg>;
export type { Handlers };

export function openSocket(url: string, name: string, entry: Create | Join | Quick, h: Handlers<ServerMsg>, env?: Env): Socket {
  return new CoreSocket<ClientMsg, ServerMsg>(url, name, entry, h, { version: VERSION, policy: POLICY }, env);
}
