import { err, ok } from "@/types/result";
import type { GoogleResult } from "./contracts";

// URL parsers normalize dot segments even when encodeURIComponent was used. Accept
// opaque provider IDs (including recurring underscores), but never a traversing segment.
export function googleRequestPath(segments: readonly string[]): GoogleResult<string> {
  const encoded: string[] = [];
  for (const segment of segments) {
    if (segment.length === 0 || /^\.+$/.test(segment)) return err({ kind: "invalid_input" });
    try {
      encoded.push(encodeURIComponent(segment));
    } catch {
      return err({ kind: "invalid_input" });
    }
  }
  return ok(`/${encoded.join("/")}`);
}
