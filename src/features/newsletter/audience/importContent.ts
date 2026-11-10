import { TRPCError } from "@trpc/server";
import { parseCsv } from "@/features/import/csvParse";
import { type ImportLogEntry, type ImportLogEvent, importMaxBytes } from "./contracts";

function invalidFile(): never {
  throw new TRPCError({ code: "BAD_REQUEST", message: "audience_invalid_csv" });
}

export function validatedCsv(content: string, delimiter: string): Uint8Array<ArrayBuffer> {
  const bytes = Uint8Array.from(Buffer.from(content, "base64"));
  if (bytes.length === 0 || bytes.length > importMaxBytes) invalidFile();
  if (Buffer.from(bytes).toString("base64") !== content) invalidFile();

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalidFile();
  }
  if (text.includes("\0")) invalidFile();
  const rows = text.trimStart().split(/\r?\n/, 2);
  const header = rows[0] ?? "";
  if (rows.length < 2 || text.trimEnd().length <= text.indexOf(header) + header.length)
    invalidFile();
  const { headers } = parseCsv(header.replaceAll(delimiter, ","));
  if (headers.filter((field) => field === "email").length !== 1) invalidFile();
  return bytes;
}

function safeLogEvent(line: string): ImportLogEntry | null {
  // Keep upstream progress and line numbers. Messages can contain full CSV rows and credentials.
  const message = line.replace(/^.*?importer\.go:\d+:\s*/, "");
  if (message.startsWith("processing ")) return { kind: "started" };
  if (message.startsWith("ignoring unknown header ")) return { kind: "ignoredColumn" };
  if (message === "imported finished") return { kind: "finished" };
  if (message === "stop request received") return { kind: "stopped" };
  if (message.startsWith("error ")) return { kind: "failed" };

  const skipped = /^skipping line (\d{1,8})\b/.exec(message)?.[1];
  if (skipped !== undefined) return { kind: "skippedRow", count: Number(skipped) };
  const attributes = /^skipping invalid attributes JSON on line (\d{1,8})\b/.exec(message)?.[1];
  if (attributes !== undefined) return { kind: "invalidAttributes", count: Number(attributes) };
  const committed = /^imported (\d{1,8})$/.exec(message)?.[1];
  if (committed !== undefined) return { kind: "committed", count: Number(committed) };
  return null;
}

export function projectImportLogs(raw: string): ImportLogEvent[] {
  const tail = raw.slice(-64_000);
  let offset = raw.length - tail.length;
  const events: ImportLogEvent[] = [];
  for (const line of tail.split("\n")) {
    const event = safeLogEvent(line.trim());
    if (event !== null) events.push({ ...event, id: offset });
    offset += line.length + 1;
  }
  return events.slice(-100);
}
