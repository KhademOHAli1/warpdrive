import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDealActionError } from "@/features/deal-workspace/DealActionErrorProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { type BoardData, removeCard, upsertCard } from "./boardCache";
import type { BoardCard } from "./dealRepo";
import { updateDealAction } from "./updateAction";
import { BOARD_QUERY_KEY } from "./useDealMove";

export interface DealCloseInput {
  dealId: string;
  status: "won" | "lost";
  expectedWriteVersion: string;
}
type CloseContext = { previousRow: BoardCard | undefined; optimisticData: BoardData | undefined };

export function useDealClose(pipelineId: string) {
  const client = useQueryClient();
  const reportError = useDealActionError();
  const key = BOARD_QUERY_KEY(pipelineId);

  function restoreOwned(input: DealCloseInput, context: CloseContext | undefined): void {
    if (context?.previousRow === undefined || context.optimisticData === undefined) return;
    const previousRow = context.previousRow;
    client.setQueryData<BoardData>(key, (data) => {
      if (
        data === undefined ||
        data !== context.optimisticData ||
        data.cards.some((row) => row.id === input.dealId)
      )
        return data;
      return upsertCard(data, previousRow);
    });
  }

  const mutation = useMutation({
    mutationFn: (input: DealCloseInput) =>
      updateDealAction(
        {
          dealId: input.dealId,
          status: input.status,
          expectedWriteVersion: input.expectedWriteVersion,
        },
        readCsrfToken(),
      ),
    onMutate: async (input: DealCloseInput): Promise<CloseContext> => {
      await client.cancelQueries({ queryKey: key });
      const data = client.getQueryData<BoardData>(key);
      const previousRow = data?.cards.find((row) => row.id === input.dealId);
      if (
        typeof input.expectedWriteVersion !== "string" ||
        input.expectedWriteVersion === "" ||
        data === undefined ||
        previousRow?.writeVersion !== input.expectedWriteVersion
      )
        return { previousRow: undefined, optimisticData: undefined };
      client.setQueryData<BoardData>(key, removeCard(data, input.dealId));
      return { previousRow, optimisticData: client.getQueryData<BoardData>(key) };
    },
    onError: (_error, input, context) => {
      restoreOwned(input, context);
      reportError();
    },
    onSettled: async (result, _error, input, context) => {
      if (result !== undefined && !result.ok) {
        restoreOwned(input, context);
        reportError(result.error.id);
      }
      await client.invalidateQueries({ queryKey: key });
    },
  });
  return { close: (input: DealCloseInput) => mutation.mutate(input) };
}
