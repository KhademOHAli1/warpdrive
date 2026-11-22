import { z } from "zod";

const id = z.uuid().toLowerCase();
const request = { itemId: id, requestId: id };
const version = z.number().int().min(1).max(2_147_483_647);
const change = { changeId: id, expectedVersion: version };
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/u);
const reason = z.string().trim().min(1).max(300);
const instant = z.iso.datetime({ precision: 3 });

export const engineeringWorkspaceInput = z.strictObject({ itemId: id, actorId: id.optional() });
export const engineeringReviewInput = engineeringWorkspaceInput.extend({ candidateReleaseId: id });

export const engineeringCommandInput = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("submit"),
    ...request,
    revise: z.strictObject(change).optional(),
    candidateReleaseId: id,
    baseReleaseId: id,
    fingerprint,
    reason,
    effectiveAt: instant,
  }),
  z.strictObject({ type: z.literal("approve"), ...request, ...change, fingerprint }),
  z.strictObject({ type: z.literal("return"), ...request, ...change, note: reason }),
  z.strictObject({ type: z.literal("withdraw"), ...request, ...change }),
  z.strictObject({
    type: z.literal("disposition"),
    ...request,
    changeId: id,
    positionId: id,
    expectedPositionVersion: z.string().regex(/^[0-9]{1,20}$/u),
    action: z.enum(["hold", "release"]),
    reason,
  }),
]);
