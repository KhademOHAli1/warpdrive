import type SMTPConnection from "nodemailer/lib/smtp-connection";
import { z } from "zod";
import { RAW_MIME_LIMITS } from "./rawMimeTypes";
import type { SmtpFailure } from "./smtpTypes";

const smtpErrorSchema = z.object({
  code: z.string().optional(),
  originalCode: z.string().optional(),
  responseCode: z.number().optional(),
});

export function smtpFailure(error: unknown, sending: boolean): SmtpFailure {
  const parsed = smtpErrorSchema.safeParse(error);
  const code = parsed.success ? (parsed.data.originalCode ?? parsed.data.code ?? "") : "";
  const responseCode = parsed.success ? parsed.data.responseCode : undefined;
  if (code === "EAUTH" || responseCode === 535)
    return { kind: "authentication", retrySafe: !sending };
  if (/TLS|CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/i.test(code))
    return { kind: "tls", retrySafe: !sending };
  if (responseCode !== undefined && responseCode >= 400)
    return { kind: "submission_rejected", retrySafe: true, responseCode };
  if (sending) return { kind: "submission_unknown", retrySafe: false };
  return { kind: code === "ETIMEDOUT" ? "timeout" : "connection", retrySafe: true };
}

export function smtpSupportsUtf8(connection: SMTPConnection): boolean {
  // Nodemailer 10.3.1 exposes no public EHLO capability getter. Pin/qualify this boundary;
  // an SDK change fails closed, rather than sending an illegal UTF-8 envelope silently.
  const capabilities: unknown = Reflect.get(connection, "_supportedExtensions");
  const parsed = z.array(z.string()).safeParse(capabilities);
  return parsed.success && parsed.data.includes("SMTPUTF8");
}

export function prepareSmtpRaw(raw: Buffer | string): {
  raw: Buffer;
  messageId: string | null;
} | null {
  const source = typeof raw === "string" ? Buffer.from(raw) : raw;
  if (source.length > RAW_MIME_LIMITS.messageBytes) return null;
  const end = source.indexOf("\r\n\r\n");
  const fallback = source.indexOf("\n\n");
  const boundary = end >= 0 ? end : fallback;
  const delimiter = end >= 0 ? "\r\n\r\n" : "\n\n";
  if (boundary < 0 || boundary > RAW_MIME_LIMITS.headerBytes) return null;
  const groups = source
    .subarray(0, boundary)
    .toString("latin1")
    .split(/\r?\n(?=[^ \t])/);
  const kept = groups.filter((group) => !/^(?:resent-)?bcc[ \t]*:/i.test(group));
  const headers = kept.join("\r\n");
  const messageId = /^message-id:[ \t]*([^\r\n]+)/im.exec(headers)?.[1]?.trim() ?? null;
  return {
    raw: Buffer.concat([
      Buffer.from(headers + delimiter, "latin1"),
      source.subarray(boundary + delimiter.length),
    ]),
    messageId,
  };
}
