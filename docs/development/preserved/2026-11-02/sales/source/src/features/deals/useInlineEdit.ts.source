import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDealActionError } from "@/features/deal-workspace/DealActionErrorProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { DEAL_LIST_QUERY_ROOT } from "./dealListQueryKey";
import type { DealListRow } from "./dealListTypes";
import { listRowFromDealAck } from "./listAck";
import { updateDealAction } from "./updateAction";

export interface EditArgs {
  dealId: string;
  field: "title" | "value" | "expectedCloseDate" | "status";
  value: string | number | null;
  expectedWriteVersion: string;
}
interface ListData {
  rows: DealListRow[];
  total: number;
  totalValue: string;
}
type OwnedRow = {
  key: readonly unknown[];
  previous: DealListRow;
  optimistic: DealListRow | undefined;
};

export function useInlineEdit(pipelineId: string) {
  const client = useQueryClient();
  const reportError = useDealActionError();
  const listKey = [DEAL_LIST_QUERY_ROOT, pipelineId];

  function restoreOwned(owned: OwnedRow[], input: EditArgs): void {
    for (const entry of owned)
      client.setQueryData<ListData>(entry.key, (data) => {
        const current = data?.rows.find((row) => row.id === input.dealId);
        if (
          data === undefined ||
          current !== entry.optimistic ||
          current?.writeVersion !== input.expectedWriteVersion
        )
          return data;
        return {
          ...data,
          rows: data.rows.map((row) => (row.id === input.dealId ? entry.previous : row)),
        };
      });
  }

  const mutation = useMutation({
    mutationFn: (input: EditArgs) =>
      updateDealAction(
        {
          dealId: input.dealId,
          expectedWriteVersion: input.expectedWriteVersion,
          [input.field]: input.value,
        },
        readCsrfToken(),
      ),
    onMutate: async (input: EditArgs) => {
      await client.cancelQueries({ queryKey: listKey });
      const owned: OwnedRow[] = [];
      if (typeof input.expectedWriteVersion !== "string" || input.expectedWriteVersion === "")
        return { owned };
      for (const [key, data] of client.getQueriesData<ListData>({ queryKey: listKey })) {
        const previous = data?.rows.find((row) => row.id === input.dealId);
        if (previous !== undefined && previous.writeVersion === input.expectedWriteVersion)
          owned.push({ key, previous, optimistic: undefined });
      }
      client.setQueriesData<ListData>({ queryKey: listKey }, (data) =>
        data === undefined
          ? data
          : {
              ...data,
              rows: data.rows.map((row) =>
                row.id === input.dealId && row.writeVersion === input.expectedWriteVersion
                  ? { ...row, [input.field]: input.value }
                  : row,
              ),
            },
      );
      for (const entry of owned)
        entry.optimistic = client
          .getQueryData<ListData>(entry.key)
          ?.rows.find((row) => row.id === input.dealId);
      return { owned };
    },
    onError: (_error, input, context) => {
      if (context !== undefined) restoreOwned(context.owned, input);
      reportError();
    },
    onSuccess: (result, input, context) => {
      if (!result.ok) return;
      for (const entry of context.owned)
        client.setQueryData<ListData>(entry.key, (data) => {
          const current = data?.rows.find((row) => row.id === input.dealId);
          if (
            data === undefined ||
            current !== entry.optimistic ||
            current?.writeVersion !== input.expectedWriteVersion
          )
            return data;
          return {
            ...data,
            rows: data.rows.map((row) =>
              row.id === input.dealId ? listRowFromDealAck(row, result.deal) : row,
            ),
          };
        });
    },
    onSettled: async (result, _error, input, context) => {
      if (result !== undefined && !result.ok) {
        if (context !== undefined) restoreOwned(context.owned, input);
        reportError(result.error.id);
      }
      await client.invalidateQueries({ queryKey: listKey });
    },
  });
  return {
    editCell: async (input: EditArgs) => {
      try {
        return await mutation.mutateAsync(input);
      } catch {
        return { ok: false as const, error: { id: "" } };
      }
    },
  };
}
