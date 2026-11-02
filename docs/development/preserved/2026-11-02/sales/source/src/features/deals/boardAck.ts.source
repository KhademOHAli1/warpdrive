import type { BoardData } from "./boardCache";
import type { BoardCard } from "./dealRepo";
import type { DealActionSnapshot } from "./dealVersion";

// Replace all persisted card fields from one final acknowledgment. Retain joined display
// metadata only when its relation still matches; never advance a token on an old optimistic row.
export function applyBoardAck(data: BoardData, deal: DealActionSnapshot): BoardData {
  const previous = data.cards.find((card) => card.id === deal.id);
  if (previous === undefined) return data;
  if (deal.status !== "open" || deal.deletedAt !== null || deal.archivedAt !== null)
    return { ...data, cards: data.cards.filter((card) => card.id !== deal.id) };
  const card = cardFromDealAck(deal, previous);
  return { ...data, cards: data.cards.map((row) => (row.id === deal.id ? card : row)) };
}

export function cardFromDealAck(deal: DealActionSnapshot, previous: BoardCard): BoardCard {
  return {
    id: deal.id,
    title: deal.title,
    value: deal.value,
    currency: deal.currency,
    status: deal.status,
    labels: deal.labels,
    stageId: deal.stageId,
    boardPosition: deal.boardPosition,
    ownerId: deal.ownerId,
    personId: deal.personId,
    orgId: deal.orgId,
    ownerName: previous.ownerId === deal.ownerId ? previous.ownerName : null,
    ownerAvatarUrl: previous.ownerId === deal.ownerId ? previous.ownerAvatarUrl : null,
    personName: previous.personId === deal.personId ? previous.personName : null,
    orgName: previous.orgId === deal.orgId ? previous.orgName : null,
    nextActivityAt: deal.nextActivityAt,
    lastActivityAt: deal.lastActivityAt,
    nextActivityTitle:
      previous.nextActivityAt?.getTime() === deal.nextActivityAt?.getTime()
        ? previous.nextActivityTitle
        : null,
    expectedCloseDate: deal.expectedCloseDate,
    stageEnteredAt: deal.stageEnteredAt,
    updatedAt: new Date(deal.updatedAt),
    writeVersion: deal.writeVersion,
  };
}
