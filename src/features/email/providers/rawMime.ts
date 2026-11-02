import { Readable, Transform } from "node:stream";
import { MailParser } from "mailparser";
import { err, ok, type Result } from "@/types/result";
import {
  createDeliveryReportScan,
  deliveryReportMediaType,
  drainDeliveryPart,
} from "./rawMimeDeliveryReports";
import { rawMimeFields } from "./rawMimeFields";
import {
  RAW_MIME_LIMITS,
  type RawMailAttachment,
  type RawMimeFailure,
  type RawMimeLimits,
  type RawParsedMail,
} from "./rawMimeTypes";

export type { RawParsedMail } from "./rawMimeTypes";

export async function parseRawMime(args: {
  source: Buffer | Readable;
  limits?: Partial<RawMimeLimits>;
  signal: AbortSignal;
}): Promise<Result<RawParsedMail, RawMimeFailure>> {
  if (args.signal.aborted && !Buffer.isBuffer(args.source)) args.source.destroy();
  args.signal.throwIfAborted();
  const limits = { ...RAW_MIME_LIMITS, ...args.limits };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1))
    return err({ kind: "invalid_limits" });

  const source = Buffer.isBuffer(args.source) ? Readable.from([args.source]) : args.source;
  const parser = new MailParser({
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
    skipTextLinks: true,
    keepDeliveryStatus: true,
    maxHeadSize: limits.headerBytes,
    maxChildNodes: limits.partCount,
  });
  const reports = createDeliveryReportScan(limits, args.signal);
  const attachments: RawMailAttachment[] = [];
  const attachmentStreams = new Set<Readable>();
  let messageBytes = 0;
  let headerBytes = 0;
  let headerComplete = false;
  let headerTail = Buffer.alloc(0);
  let attachmentCount = 0;
  let finished = false;

  return new Promise((resolve, reject) => {
    function cleanup() {
      args.signal.removeEventListener("abort", abort);
      source.unpipe();
      source.destroy();
      limiter.destroy();
      parser.destroy();
      reports.destroy();
      for (const stream of attachmentStreams) stream.destroy();
    }
    function failure(kind: RawMimeFailure["kind"]) {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(err({ kind }));
    }
    function abort() {
      if (finished) return;
      finished = true;
      cleanup();
      try {
        args.signal.throwIfAborted();
      } catch (error) {
        reject(error instanceof Error ? error : new DOMException("Parsing aborted", "AbortError"));
      }
    }
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, next) {
        messageBytes += chunk.length;
        if (messageBytes > limits.messageBytes) {
          failure("message_too_large");
          next();
          return;
        }
        if (!headerComplete) {
          const scan = Buffer.concat([headerTail, chunk]);
          const delimiter = scan.indexOf("\r\n\r\n");
          const fallback = scan.indexOf("\n\n");
          const end = delimiter >= 0 ? delimiter + 4 : fallback >= 0 ? fallback + 2 : -1;
          headerBytes += end < 0 ? chunk.length : Math.max(0, end - headerTail.length);
          headerComplete = end >= 0;
          headerTail = scan.subarray(Math.max(0, scan.length - 3));
          if (headerBytes > limits.headerBytes) {
            failure("headers_too_large");
            next();
            return;
          }
        }
        next(null, chunk);
      },
    });

    parser.on("data", (part) => {
      if (part.type !== "attachment" || finished) return;
      if (deliveryReportMediaType(part.headers) !== null) {
        attachmentStreams.add(part.content);
        drainDeliveryPart(part, () => failure("invalid_message"));
        part.content.on("end", () => attachmentStreams.delete(part.content));
        return;
      }
      attachmentCount += 1;
      if (attachmentCount > limits.attachmentCount) {
        failure("too_many_attachments");
        return;
      }
      const partKey = part.partId ?? "1";
      const chunks: Buffer[] = [];
      let size = 0;
      attachmentStreams.add(part.content);
      part.content.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > limits.attachmentBytes) failure("attachment_too_large");
        else chunks.push(chunk);
      });
      part.content.on("error", () => failure("invalid_message"));
      part.content.on("end", () => {
        attachmentStreams.delete(part.content);
        if (finished) return;
        attachments.push({
          partKey,
          filename: part.filename ?? "attachment",
          contentType: part.contentType,
          disposition: part.contentDisposition === "inline" ? "inline" : "attachment",
          contentId: part.contentId ?? null,
          size,
          content: Buffer.concat(chunks, size),
        });
        part.release?.();
      });
    });
    parser.on("end", () => {
      if (finished) return;
      const bodyBytes =
        Buffer.byteLength(parser.text === false ? "" : parser.text) +
        Buffer.byteLength(parser.html === false ? "" : parser.html);
      if (bodyBytes > limits.bodyBytes) {
        failure("body_too_large");
        return;
      }
      void reports.result.then((delivery) => {
        if (finished) return;
        const parsed = rawMimeFields(parser, attachments);
        finished = true;
        cleanup();
        resolve(ok({ ...parsed, ...delivery }));
      });
    });
    source.on("error", () => failure("invalid_message"));
    limiter.on("error", () => failure("invalid_message"));
    parser.on("error", () => failure("invalid_message"));
    args.signal.addEventListener("abort", abort, { once: true });
    if (args.signal.aborted) abort();
    else {
      limiter.pipe(parser);
      limiter.pipe(reports.stream);
      source.pipe(limiter);
    }
  });
}
