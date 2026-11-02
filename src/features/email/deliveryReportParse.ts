import { err, ok, type Result } from "@/types/result";
import {
  byteLength,
  fieldValue,
  MESSAGE_FIELDS,
  RECIPIENT_FIELDS,
  readReportFields,
  typedValue,
  validLanguageTag,
  withoutComments,
} from "./deliveryReportFields";
import {
  type DeliveryReportFailure,
  type DeliveryReportField,
  type DeliveryReportInput,
  type DeliveryReportRecipient,
  DELIVERY_REPORT_LIMITS as LIMITS,
  type ParsedDeliveryReport,
} from "./deliveryReportTypes";

function readInput(input: unknown): Result<DeliveryReportInput, DeliveryReportFailure> {
  try {
    if (typeof input !== "object" || input === null) return err({ code: "invalid_input" });
    const content: unknown = Reflect.get(input, "content");
    const media: unknown = Reflect.get(input, "mediaType");
    const provenance: unknown = Reflect.get(input, "provenance");
    if (!(content instanceof Uint8Array) || !Number.isSafeInteger(content.byteLength))
      return err({ code: "invalid_input" });
    if (provenance !== "direct" && provenance !== "nested" && provenance !== "forwarded")
      return err({ code: "invalid_input" });
    const mediaType = typeof media === "string" && media.length <= 64 ? media.toLowerCase() : "";
    if (mediaType !== "message/delivery-status" && mediaType !== "message/global-delivery-status")
      return err({ code: "unsupported_media_type" });
    return ok({ content, mediaType, provenance });
  } catch {
    return err({ code: "invalid_input" });
  }
}

function contentCharacters(
  text: string,
  traditional: boolean,
): Result<void, DeliveryReportFailure> {
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (traditional && code > 127) return err({ code: "non_ascii_dsn" });
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159))
      return err({ code: "malformed_field" });
  }
  return ok(undefined);
}

function decodeContent(input: DeliveryReportInput): Result<string, DeliveryReportFailure> {
  if (input.content.byteLength > LIMITS.messageBytes) return err({ code: "limit_exceeded" });
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.content);
  } catch {
    return err({ code: "invalid_utf8" });
  }
  const characters = contentCharacters(text, input.mediaType === "message/delivery-status");
  if (!characters.ok) return characters;
  if (/[\r\n]/u.test(text.replaceAll("\r\n", ""))) return err({ code: "invalid_line_endings" });
  let end = text.length;
  while (end >= 2 && text[end - 2] === "\r" && text[end - 1] === "\n") end -= 2;
  return ok(text.slice(0, end));
}

function actionAndStatus(
  fields: DeliveryReportField[],
): Result<
  Pick<
    DeliveryReportRecipient,
    "action" | "status" | "statusClass" | "terminalReport" | "actionStatus"
  >,
  DeliveryReportFailure
> {
  const rawAction = fieldValue(fields, "action");
  const rawStatus = fieldValue(fields, "status");
  if (rawAction === null || rawStatus === null) return err({ code: "missing_field" });
  const actionToken = withoutComments(rawAction);
  const statusToken = withoutComments(rawStatus);
  if (!actionToken.ok) return actionToken;
  if (!statusToken.ok) return statusToken;
  const action = actionToken.value.toLowerCase();
  if (
    action !== "failed" &&
    action !== "delayed" &&
    action !== "delivered" &&
    action !== "relayed" &&
    action !== "expanded"
  )
    return err({ code: "invalid_action" });
  const status = statusToken.value;
  if (!/^[245]\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})$/u.test(status))
    return err({ code: "invalid_status" });
  const statusClass = status.startsWith("2") ? 2 : status.startsWith("4") ? 4 : 5;
  const consistent =
    action === "failed"
      ? statusClass !== 2
      : action === "delayed"
        ? statusClass === 4
        : statusClass === 2;
  return ok({
    action,
    status,
    statusClass,
    terminalReport: action === "failed" || action === "delivered",
    actionStatus: consistent ? "consistent" : "conflict",
  });
}

function diagnostics(
  fields: DeliveryReportField[],
  global: boolean,
): Result<
  Pick<DeliveryReportRecipient, "diagnostic" | "localizedDiagnostics">,
  DeliveryReportFailure
> {
  const raw = fieldValue(fields, "diagnostic-code");
  const diagnostic = typedValue(raw);
  if (!diagnostic.ok) return diagnostic;
  if (diagnostic.value !== null && byteLength(diagnostic.value.value) > LIMITS.diagnosticBytes)
    return err({ code: "limit_exceeded" });
  const localized = fields.filter((field) => field.name === "localized-diagnostic");
  if (localized.length > LIMITS.localizedDiagnostics) return err({ code: "limit_exceeded" });
  if (localized.length > 0 && (!global || raw === null)) return err({ code: "invalid_diagnostic" });
  const localizedDiagnostics: DeliveryReportRecipient["localizedDiagnostics"] = [];
  const seen = new Set<string>();
  for (const field of localized) {
    const entry = typedValue(field.value);
    if (!entry.ok || entry.value === null || !validLanguageTag(entry.value.type))
      return err({ code: "invalid_diagnostic" });
    if (seen.has(entry.value.type)) return err({ code: "duplicate_field" });
    if (byteLength(entry.value.value) > LIMITS.diagnosticBytes)
      return err({ code: "limit_exceeded" });
    seen.add(entry.value.type);
    localizedDiagnostics.push({
      languageTag: entry.value.type,
      text: entry.value.value,
      display: "plain_text",
    });
  }
  return ok({
    diagnostic:
      diagnostic.value === null
        ? null
        : { type: diagnostic.value.type, text: diagnostic.value.value, display: "plain_text" },
    localizedDiagnostics,
  });
}

function recipient(
  fields: DeliveryReportField[],
  global: boolean,
): Result<DeliveryReportRecipient, DeliveryReportFailure> {
  const finalRecipient = typedValue(fieldValue(fields, "final-recipient"));
  const originalRecipient = typedValue(fieldValue(fields, "original-recipient"));
  const remoteMta = typedValue(fieldValue(fields, "remote-mta"));
  if (!finalRecipient.ok) return finalRecipient;
  if (!originalRecipient.ok) return originalRecipient;
  if (!remoteMta.ok) return remoteMta;
  if (finalRecipient.value === null) return err({ code: "missing_field" });
  const state = actionAndStatus(fields);
  if (!state.ok) return state;
  const diagnostic = diagnostics(fields, global);
  if (!diagnostic.ok) return diagnostic;
  return ok({
    finalRecipient: finalRecipient.value,
    originalRecipient: originalRecipient.value,
    remoteMta: remoteMta.value,
    ...state.value,
    ...diagnostic.value,
    lastAttemptDate: fieldValue(fields, "last-attempt-date"),
    finalLogId: fieldValue(fields, "final-log-id"),
    willRetryUntil: fieldValue(fields, "will-retry-until"),
    extensions: fields.filter((field) => !RECIPIENT_FIELDS.has(field.name)),
  });
}

/** Decoded machine part only: caller-declared provenance is never authority.
 * RFC3464/6533 observations require review; no matching, IO or side effects.
 */
export function parseDeliveryReport(
  input: unknown,
): Result<ParsedDeliveryReport, DeliveryReportFailure> {
  const shape = readInput(input);
  if (!shape.ok) return shape;
  const decoded = decodeContent(shape.value);
  if (!decoded.ok) return decoded;
  const blocks = decoded.value.split("\r\n\r\n");
  if (blocks.length < 2) return err({ code: "missing_field" });
  if (blocks.length - 1 > LIMITS.recipientBlocks) return err({ code: "limit_exceeded" });
  const message = readReportFields(blocks[0] ?? "", "message");
  if (!message.ok) return message;
  const reportingMta = typedValue(fieldValue(message.value, "reporting-mta"));
  const dsnGateway = typedValue(fieldValue(message.value, "dsn-gateway"));
  const receivedFromMta = typedValue(fieldValue(message.value, "received-from-mta"));
  if (!reportingMta.ok) return reportingMta;
  if (!dsnGateway.ok) return dsnGateway;
  if (!receivedFromMta.ok) return receivedFromMta;
  if (reportingMta.value === null) return err({ code: "missing_field" });
  const recipients: DeliveryReportRecipient[] = [];
  for (const block of blocks.slice(1)) {
    const fields = readReportFields(block, "recipient");
    if (!fields.ok) return fields;
    const parsed = recipient(
      fields.value,
      shape.value.mediaType === "message/global-delivery-status",
    );
    if (!parsed.ok) return parsed;
    recipients.push(parsed.value);
  }
  return ok({
    mediaType: shape.value.mediaType,
    provenance: shape.value.provenance,
    trust: "unverified",
    requiresReview: true,
    correlationAuthority: false,
    reportingMta: reportingMta.value,
    dsnGateway: dsnGateway.value,
    receivedFromMta: receivedFromMta.value,
    originalEnvelopeId: fieldValue(message.value, "original-envelope-id"),
    arrivalDate: fieldValue(message.value, "arrival-date"),
    extensions: message.value.filter((field) => !MESSAGE_FIELDS.has(field.name)),
    recipients,
  });
}
