import { escapeCsv } from "./csvSafe";

export interface ErrorReportRow {
  rowNumber: number;
  raw: Record<string, string>;
  errors: { field: string; message: string }[];
  warnings: { field: string; message: string }[];
}

function flatten(items: { field: string; message: string }[]): string {
  return items.map((e) => `${e.field}: ${e.message}`).join("; ");
}

export function buildErrorCsv(rows: ErrorReportRow[]): string {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r.raw)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  }
  const head = ["row", "errors", "warnings", ...headers].map(escapeCsv).join(",");
  const lines = rows.map((r) => {
    const cells = [
      String(r.rowNumber),
      flatten(r.errors),
      flatten(r.warnings),
      ...headers.map((h) => r.raw[h] ?? ""),
    ];
    return cells.map(escapeCsv).join(",");
  });
  return [head, ...lines].join("\n");
}
