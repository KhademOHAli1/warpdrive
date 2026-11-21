import type { ReleaseBomEntry } from "./schema";

const utf8 = new TextDecoder("utf-8", { fatal: true });
export const releaseBomMaxBytes = 64 * 1024;

// Exact two-column release format. These fields never require embedded delimiters
// or escaping; optional spreadsheet quoting is accepted.
const header = /^\s*(?:"sku"|sku)\s*,\s*(?:"quantity"|quantity)\s*$/i;
const row =
  /^\s*(?:"([A-Z0-9][A-Z0-9_.-]{0,39})"|([A-Z0-9][A-Z0-9_.-]{0,39}))\s*,\s*(?:"([1-9]\d{0,6})"|([1-9]\d{0,6}))\s*$/i;

export function parseReleaseBom(bytes: Uint8Array): ReleaseBomEntry[] | null {
  if (bytes.byteLength > releaseBomMaxBytes) return null;
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return null;
  }
  const [columns, ...lines] = text.split(/\r\n|\n|\r/).filter((line) => line.trim().length > 0);
  if (columns === undefined || !header.test(columns) || lines.length === 0 || lines.length > 30)
    return null;
  const seen = new Set<string>();
  const bom: ReleaseBomEntry[] = [];
  for (const line of lines) {
    const match = row.exec(line);
    if (!match) return null;
    const sku = (match[1] ?? match[2] ?? "").toUpperCase();
    const quantity = Number(match[3] ?? match[4]);
    if (seen.has(sku) || quantity > 1_000_000) return null;
    seen.add(sku);
    bom.push({ sku, quantity });
  }
  return bom;
}
