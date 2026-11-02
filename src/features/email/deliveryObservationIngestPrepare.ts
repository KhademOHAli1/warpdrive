import { createHash } from "node:crypto";
import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import { parseDeliveryReport } from "./deliveryReportParse";
import { DELIVERY_REPORT_LIMITS, type ParsedDeliveryReport } from "./deliveryReportTypes";
import { RAW_DELIVERY_REPORT_LIMITS } from "./providers/rawMimeTypes";

const PART_KEY_BYTES = 2048;
const MEDIA_TYPE_CHARS = 64;
const partSchema = z.strictObject({
  partKey: z
    .string()
    .min(1)
    .max(PART_KEY_BYTES)
    .regex(/^[0-9]+([.!][0-9]+)*$/),
  content: z.instanceof(Uint8Array),
  mediaType: z.unknown(),
  provenance: z.unknown(),
});
const partsSchema = z
  .custom<unknown[]>(
    (value) => Array.isArray(value) && value.length <= RAW_DELIVERY_REPORT_LIMITS.retainedParts,
  )
  .pipe(z.array(partSchema));
const ingestSchema = z.strictObject({
  accountId: z.guid(),
  sourceMessageId: z.guid(),
  parts: partsSchema,
});

interface DeliveryObservationPartIdentity {
  partKey: string;
  contentHash: string | null;
  contentBytes: number;
  mediaType: string | null;
  provenance: string | null;
}

export type PreparedDeliveryObservationPart = DeliveryObservationPartIdentity &
  (
    | { kind: "parsed"; contentHash: string; parsed: ParsedDeliveryReport }
    | { kind: "skipped"; parsed: null }
  );

export interface PreparedDeliveryObservationBatch {
  accountId: string;
  sourceMessageId: string;
  parts: PreparedDeliveryObservationPart[];
}

function snapshotPart(part: z.infer<typeof partSchema>): PreparedDeliveryObservationPart {
  const identity = {
    partKey: part.partKey,
    contentBytes: part.content.byteLength,
    mediaType:
      typeof part.mediaType === "string" && part.mediaType.length <= MEDIA_TYPE_CHARS
        ? part.mediaType.toLowerCase()
        : null,
    provenance: typeof part.provenance === "string" ? part.provenance : null,
  };
  // Existing stored reports are bounded, so an oversized replay is necessarily different.
  // Retain its identity/size without copying or hashing unbounded caller bytes.
  if (identity.contentBytes > DELIVERY_REPORT_LIMITS.messageBytes)
    return { ...identity, contentHash: null, kind: "skipped", parsed: null };
  const content = Buffer.from(part.content);
  const contentHash = createHash("sha256").update(content).digest("hex");
  const parsed = parseDeliveryReport({
    content,
    mediaType: part.mediaType,
    provenance: part.provenance,
  });
  if (!parsed.ok) return { ...identity, contentHash, kind: "skipped", parsed: null };
  return {
    ...identity,
    mediaType: parsed.value.mediaType,
    provenance: parsed.value.provenance,
    contentHash,
    kind: "parsed",
    parsed: parsed.value,
  };
}

export function prepareDeliveryObservations(
  input: unknown,
  signal: AbortSignal,
): Result<PreparedDeliveryObservationBatch, "invalid_input"> {
  signal.throwIfAborted();
  const shape = ingestSchema.safeParse(input);
  if (!shape.success) return err("invalid_input");
  const keys = new Set(shape.data.parts.map((part) => part.partKey));
  if (keys.size !== shape.data.parts.length) return err("invalid_input");

  const parts: PreparedDeliveryObservationPart[] = [];
  for (const part of shape.data.parts) {
    signal.throwIfAborted();
    // Malformed parts must keep their identity until an existing-key replay is checked.
    parts.push(snapshotPart(part));
  }
  return ok({
    accountId: shape.data.accountId,
    sourceMessageId: shape.data.sourceMessageId,
    parts,
  });
}
