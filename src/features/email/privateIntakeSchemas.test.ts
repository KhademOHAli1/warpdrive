import { expect, it } from "vitest";
import {
  privateIntakeReadInputSchema,
  privateIntakeReviewInputSchema,
  privateIntakeSummarySchema,
} from "./privateIntakeSchemas";

const scope = {
  accountId: "11111111-1111-4111-8111-111111111111",
  intakeId: "22222222-2222-4222-8222-222222222222",
};
const review = { ...scope, expectedRevision: 0, decision: "keep_private" };

it("accepts the exact mailbox/intake scope and each local review decision", () => {
  expect(privateIntakeReadInputSchema.parse(scope)).toEqual(scope);
  for (const decision of ["keep_private", "dismiss", "restore_private"])
    expect(privateIntakeReviewInputSchema.parse({ ...review, decision })).toEqual({
      ...review,
      decision,
    });
});

it.each(["accountId", "intakeId"])("rejects missing or malformed %s", (field) => {
  expect(privateIntakeReadInputSchema.safeParse({ ...scope, [field]: "bad-id" }).success).toBe(
    false,
  );
  expect(privateIntakeReadInputSchema.safeParse({ ...scope, [field]: undefined }).success).toBe(
    false,
  );
});

it.each([-1, 0.5, NaN, Infinity, 2_147_483_647, Number.MAX_SAFE_INTEGER])(
  "rejects a revision that cannot be advanced safely: %s",
  (expectedRevision) => {
    expect(privateIntakeReviewInputSchema.safeParse({ ...review, expectedRevision }).success).toBe(
      false,
    );
  },
);

it("does not coerce revisions or accept unknown review decisions", () => {
  expect(
    privateIntakeReviewInputSchema.safeParse({ ...review, expectedRevision: "0" }).success,
  ).toBe(false);
  expect(
    privateIntakeReviewInputSchema.safeParse({ ...review, decision: "confirm_delivery" }).success,
  ).toBe(false);
});

it.each(["actorId", "sessionId", "providerMessageId", "status", "bodyHtml", "systemPurpose"])(
  "rejects client-supplied %s authority or content",
  (field) => {
    expect(privateIntakeReviewInputSchema.safeParse({ ...review, [field]: "forged" }).success).toBe(
      false,
    );
    expect(privateIntakeReadInputSchema.safeParse({ ...scope, [field]: "forged" }).success).toBe(
      false,
    );
  },
);

it("permits only the five summary fields and known persisted states", () => {
  const summary = {
    id: scope.intakeId,
    revision: 1,
    state: "unverified",
    contentState: "retained",
    decision: null,
  };
  expect(privateIntakeSummarySchema.parse(summary)).toEqual(summary);
  expect(privateIntakeSummarySchema.safeParse({ ...summary, observedPayload: {} }).success).toBe(
    false,
  );
  expect(privateIntakeSummarySchema.safeParse({ ...summary, state: "sent" }).success).toBe(false);
  expect(
    privateIntakeSummarySchema.safeParse({ ...summary, contentState: "restored" }).success,
  ).toBe(false);
  for (const decision of ["keep_private", "dismiss", "restore_private"])
    expect(
      privateIntakeSummarySchema.parse({ ...summary, contentState: "purged", decision }),
    ).toEqual({ ...summary, contentState: "purged", decision });
});
