import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDealActionError } from "@/features/deal-workspace/DealActionErrorProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { applyBoardAck } from "./boardAck";
import { applyMove, type BoardData, upsertCard } from "./boardCache";
import { midpoint } from "./boardPosition";
import type { BoardCard } from "./dealRepo";
import { moveDealAction } from "./moveAction";
import type { DealMoveInput } from "./schemas";

export const BOARD_QUERY_KEY = (pipelineId: string) => ["board", pipelineId] as const;

type MoveContext = {
  previousRow: BoardCard | undefined;
  optimisticRow: BoardCard | undefined;
};

export function useDealMove(pipelineId: string) {
  const client = useQueryClient();
  const reportError = useDealActionError();
  const key = BOARD_QUERY_KEY(pipelineId);

  function restoreOwned(input: DealMoveInput, context: MoveContext | undefined): void {
    if (context?.previousRow === undefined || context.optimisticRow === undefined) return;
    const { previousRow, optimisticRow } = context;
    client.setQueryData<BoardData>(key, (data) => {
      const current = data?.cards.find((row) => row.id === input.dealId);
      if (
        data === undefined ||
        current === undefined ||
        current !== optimisticRow ||
        current.writeVersion !== input.expectedWriteVersion
      )
        return data;
      return upsertCard(data, previousRow);
    });
  }

  const mutation = useMutation({
    mutationFn: (input: DealMoveInput) => moveDealAction(input, readCsrfToken()),
    onMutate: async (input: DealMoveInput): Promise<MoveContext> => {
      await client.cancelQueries({ queryKey: key });
      const data = client.getQueryData<BoardData>(key);
      const previousRow = data?.cards.find((row) => row.id === input.dealId);
      if (
        typeof input.expectedWriteVersion !== "string" ||
        input.expectedWriteVersion === "" ||
        data === undefined ||
        previousRow?.writeVersion !== input.expectedWriteVersion
      )
        return { previousRow: undefined, optimisticRow: undefined };
      client.setQueryData<BoardData>(
        key,
        applyMove(data, {
          dealId: input.dealId,
          toStageId: input.toStageId,
          boardPosition: midpoint(input.beforePosition, input.afterPosition),
        }),
      );
      return {
        previousRow,
        optimisticRow: client
          .getQueryData<BoardData>(key)
          ?.cards.find((row) => row.id === input.dealId),
      };
    },
    onError: (_error, input, context) => {
      restoreOwned(input, context);
      reportError();
    },
    onSuccess: (result, input, context) => {
      if (!result.ok || context.optimisticRow === undefined) return;
      client.setQueryData<BoardData>(key, (data) => {
        const current = data?.cards.find((row) => row.id === input.dealId);
        if (
          data === undefined ||
          current === undefined ||
          current !== context.optimisticRow ||
          current.writeVersion !== input.expectedWriteVersion
        )
          return data;
        return applyBoardAck(data, result.deal);
      });
    },
    onSettled: async (result, _error, input, context) => {
      if (result !== undefined && !result.ok) {
        restoreOwned(input, context);
        reportError(result.error.id);
      }
      await client.invalidateQueries({ queryKey: key });
    },
  });
  return { move: (input: DealMoveInput) => mutation.mutate(input) };
}
