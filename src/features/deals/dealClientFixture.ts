import type { DealActionSnapshot } from "./dealVersion";

export const FIRST_DEAL_VERSION = "00000000-0000-4000-8000-000000000001";
export const SECOND_DEAL_VERSION = "00000000-0000-4000-8000-000000000002";

// Complete synthetic action acknowledgment for client tests; never an operational token.
export function dealClientFixture(overrides: Partial<DealActionSnapshot> = {}): DealActionSnapshot {
  const instant = new Date("2026-06-29T00:00:00.000Z");
  return {
    id: "a",
    title: "a",
    status: "open",
    value: null,
    currency: "USD",
    expectedCloseDate: null,
    labels: [],
    sourceChannel: null,
    sourceChannelId: null,
    lostReason: null,
    lostReasonId: null,
    wonTime: null,
    lostTime: null,
    pipelineId: "p1",
    stageId: "s1",
    boardPosition: "1",
    personId: null,
    orgId: null,
    ownerId: "u",
    visibilityLevel: "owner",
    visibilityGroupId: null,
    visibleToUserIds: [],
    lastActivityAt: null,
    nextActivityAt: null,
    stageEnteredAt: instant,
    customFields: {},
    searchTsv: "",
    createdAt: instant,
    writeVersion: FIRST_DEAL_VERSION,
    updatedAt: instant.toISOString(),
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  };
}
