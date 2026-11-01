import type { BoardCard } from "./dealRepo";

export interface BoardData {
  cards: BoardCard[];
  filterKey?: string;
  filterIsActive?: boolean;
}

function sorted(cards: BoardCard[]): BoardCard[] {
  return [...cards].sort((a, b) => {
    if (a.stageId !== b.stageId) {
      return a.stageId < b.stageId ? -1 : 1;
    }
    return Number(a.boardPosition) - Number(b.boardPosition);
  });
}

export function applyMove(
  data: BoardData,
  move: { dealId: string; toStageId: string; boardPosition: string },
): BoardData {
  const cards = data.cards.map((c) =>
    c.id === move.dealId ? { ...c, stageId: move.toStageId, boardPosition: move.boardPosition } : c,
  );
  return { ...data, cards: sorted(cards) };
}

export function removeCard(data: BoardData, dealId: string): BoardData {
  return { ...data, cards: data.cards.filter((c) => c.id !== dealId) };
}

export function upsertCard(data: BoardData, card: BoardCard): BoardData {
  const without = data.cards.filter((c) => c.id !== card.id);
  return { ...data, cards: sorted([...without, card]) };
}
