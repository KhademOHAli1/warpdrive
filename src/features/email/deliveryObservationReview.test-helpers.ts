import { expect } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { Db } from "@/db/client";
import {
  deliveryMachinePart,
  deliverySignal,
  reportedRecipient,
  seedDeliveryFixture,
} from "./deliveryObservation.test-helpers";
import { ingestDeliveryReports } from "./deliveryObservationIngest";

export async function seedObservedDelivery(db: Db) {
  const fixture = await seedDeliveryFixture(db);
  const ingested = await ingestDeliveryReports(
    db,
    {
      accountId: fixture.accountId,
      sourceMessageId: fixture.source.messageId,
      parts: [deliveryMachinePart()],
    },
    deliverySignal(),
  );
  expect(ingested.ok).toBe(true);
  if (!ingested.ok || ingested.value.reportIds[0] === undefined)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing synthetic delivery observation", {});
  const reportId = ingested.value.reportIds[0];
  const association = {
    reportId,
    recipientIndex: 0,
    expectedRevision: 0,
    decision: "associate" as const,
    confirmUnverified: true,
    target: { attemptId: fixture.attempt.attemptId, recipient: reportedRecipient },
  };
  return { ...fixture, reportId, association };
}
