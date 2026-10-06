// Debug builds only: ?map=…&wx=…&start=… are added to create messages so rooms
// with any map, weather and start can be made before the create form has them.
const KEYS = ["map", "wx", "start"] as const;

/** The room-setting query params present in params (wire names; the server validates). */
export function debugRoomParams(params: URLSearchParams): Partial<Record<(typeof KEYS)[number], string>> {
  const out: Partial<Record<(typeof KEYS)[number], string>> = {};
  for (const k of KEYS) {
    const v = params.get(k);
    if (v) out[k] = v;
  }
  return out;
}
