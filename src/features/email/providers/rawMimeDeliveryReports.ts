import { Readable } from "node:stream";
import { type AttachmentStream, type HeaderLines, type Headers, MailParser } from "mailparser";
import type { DeliveryReportMediaType } from "../deliveryReportTypes";
import {
  RAW_DELIVERY_REPORT_LIMITS as BOUNDS,
  type RawDeliveryReportPart,
  type RawMimeLimits,
} from "./rawMimeTypes";

export function declaredMimeType(headers: Headers): string | null {
  const value: unknown = headers.get("content-type");
  return typeof value === "object" &&
    value !== null &&
    "value" in value &&
    typeof value.value === "string"
    ? value.value.toLowerCase()
    : null;
}

export function deliveryReportMediaType(headers: Headers): DeliveryReportMediaType | null {
  const type = declaredMimeType(headers);
  return type === "message/delivery-status" || type === "message/global-delivery-status"
    ? type
    : null;
}

function reportType(headers: Headers, lines: HeaderLines): string | null {
  if (
    declaredMimeType(headers) !== "multipart/report" ||
    lines.filter((line) => line.key === "content-type").length !== 1
  )
    return null;
  const value: unknown = headers.get("content-type");
  if (
    typeof value !== "object" ||
    value === null ||
    !("params" in value) ||
    typeof value.params !== "object" ||
    value.params === null
  )
    return null;
  const type: unknown = Reflect.get(value.params, "report-type");
  return typeof type === "string" ? type.toLowerCase() : null;
}

interface ScanResult {
  deliveryReports: RawDeliveryReportPart[];
  deliveryReportsTruncated: boolean;
}
interface Scan {
  parser: MailParser;
  done: Promise<void>;
  stop: () => void;
}

/** Separate scanner preserves the ordinary parser's existing inline-forward behavior.
 * All provenance is structural, never authenticity or association authority.
 */
export function createDeliveryReportScan(limits: RawMimeLimits, signal: AbortSignal) {
  const parts: RawDeliveryReportPart[] = [];
  const active = new Set<Scan>();
  let truncated = false;
  let embeddedMessages = 0;
  let traversalBytes = 0;

  function scanner(prefix: string, depth: number): Scan {
    const parser = new MailParser({
      skipHtmlToText: true,
      skipTextToHtml: true,
      skipImageLinks: true,
      skipTextLinks: true,
      keepDeliveryStatus: true,
      ignoreEmbedded: true,
      maxHeadSize: limits.headerBytes,
      maxChildNodes: limits.partCount,
    });
    const streams = new Set<Readable>();
    const children: Promise<void>[] = [];
    let topHeaders: Headers = new Map();
    let topLines: HeaderLines = [];
    let stopped = false;
    let complete!: () => void;
    const done = new Promise<void>((resolve) => {
      complete = resolve;
    });
    function stop() {
      if (stopped) return;
      stopped = true;
      active.delete(scan);
      parser.destroy();
      for (const stream of streams) stream.destroy();
      complete();
    }
    const scan = { parser, done, stop };
    active.add(scan);
    parser.on("headers", (headers) => {
      topHeaders = headers;
    });
    parser.on("headerLines", (lines) => {
      topLines = lines;
    });
    parser.on("error", () => {
      truncated = true;
      stop();
    });
    parser.on("data", (part) => {
      if (part.type !== "attachment" || stopped) return;
      const mediaType = deliveryReportMediaType(part.headers);
      const embedded = ["message/rfc822", "message/global"].includes(
        declaredMimeType(part.headers) ?? "",
      );
      const partKey = `${prefix}${part.partId ?? "1"}`;
      let retain = mediaType !== null || embedded;
      if (
        (mediaType !== null && parts.length >= BOUNDS.retainedParts) ||
        (embedded &&
          (depth >= BOUNDS.forwardedDepth || embeddedMessages >= BOUNDS.embeddedMessages))
      ) {
        truncated = true;
        retain = false;
      }
      if (embedded && retain) embeddedMessages += 1;
      const chunks: Buffer[] = [];
      let size = 0;
      streams.add(part.content);
      part.content.on("data", (chunk: Buffer) => {
        if (!retain) return;
        size += chunk.length;
        if (embedded) traversalBytes += chunk.length;
        const bound = mediaType !== null ? BOUNDS.partBytes : limits.attachmentBytes;
        if (size > bound || traversalBytes > Math.min(limits.messageBytes, BOUNDS.traversalBytes)) {
          truncated = true;
          retain = false;
          chunks.length = 0;
        } else chunks.push(chunk);
      });
      part.content.on("error", () => {
        truncated = true;
        part.release?.();
      });
      part.content.on("end", () => {
        streams.delete(part.content);
        if (stopped || signal.aborted || !retain) {
          part.release?.();
          return;
        }
        const content = Buffer.concat(chunks, size);
        if (mediaType !== null) {
          const direct =
            depth === 0 &&
            part.partId === "2" &&
            reportType(topHeaders, topLines) === mediaType.slice("message/".length);
          parts.push({
            partKey,
            mediaType,
            provenance: depth > 0 ? "forwarded" : direct ? "direct" : "nested",
            content,
          });
          part.release?.();
        } else if (embedded) {
          // Defer release until this child finishes: deterministic depth-first retention.
          const child = scanner(`${partKey}!`, depth + 1);
          children.push(child.done);
          // Release on either outcome. A completion/release failure truncates and closes this
          // scanner branch instead of leaving a rejected promise or blocked parent parser.
          void child.done
            .finally(() => part.release?.())
            .catch(() => {
              truncated = true;
              child.stop();
              stop();
            });
          Readable.from([content]).pipe(child.parser);
        } else part.release?.();
      });
    });
    parser.on("end", () => {
      void Promise.all(children).then(stop, () => {
        truncated = true;
        stop();
      });
    });
    return scan;
  }

  const root = scanner("", 0);
  return {
    stream: root.parser,
    result: root.done.then(
      (): ScanResult => ({
        deliveryReports: parts.sort((left, right) =>
          left.partKey.localeCompare(right.partKey, "en", { numeric: true }),
        ),
        deliveryReportsTruncated: truncated,
      }),
    ),
    destroy() {
      for (const scan of active) scan.stop();
    },
  };
}

export function drainDeliveryPart(part: AttachmentStream, onError: () => void) {
  part.content.on("error", onError);
  part.content.on("end", () => part.release?.());
  part.content.resume();
}
