"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import { useDealActionError } from "@/features/deal-workspace/DealActionErrorProvider";
import { dealClientResult } from "@/features/deals/dealClientResult";
import { readCsrfToken } from "@/utils/csrfCookie";
import { archiveDealAction, archiveDealsAction } from "./archiveActions";
import { bulkStageAction } from "./bulkStageAction";
import { DEAL_LIST_QUERY_ROOT } from "./dealListQueryKey";

export type BulkClientResult = boolean | { appliedDealIds: string[] };

export interface DealListActions {
  bulkStage: (
    dealIds: string[],
    toStageId: string,
    expectedWriteVersions: Record<string, string>,
  ) => Promise<BulkClientResult>;
  bulkArchive: (
    dealIds: string[],
    expectedWriteVersions: Record<string, string>,
  ) => Promise<BulkClientResult>;
  unarchive: (dealId: string, expectedWriteVersion: string) => void;
}

export function useDealListActions(): DealListActions {
  const router = useRouter();
  const reportError = useDealActionError();
  const queryClient = useQueryClient();

  const bulkStage = useCallback(
    async (
      dealIds: string[],
      toStageId: string,
      expectedWriteVersions: Record<string, string>,
    ): Promise<BulkClientResult> => {
      const r = await dealClientResult(() =>
        bulkStageAction({ dealIds, toStageId, expectedWriteVersions }, readCsrfToken()),
      );
      if (!r.ok) {
        reportError(r.error.id);
        if (r.error.id === ERROR_IDS.DEAL_PRECONDITION)
          await queryClient.invalidateQueries({ queryKey: [DEAL_LIST_QUERY_ROOT] });
        return false;
      }
      if (r.rows.some((row) => row.outcome !== "applied")) {
        reportError(ERROR_IDS.DEAL_BULK_STAGE_PARTIAL);
        await queryClient.invalidateQueries({ queryKey: [DEAL_LIST_QUERY_ROOT] });
        router.refresh();
        return {
          appliedDealIds: r.rows
            .filter((row) => row.outcome === "applied")
            .map((row) => row.dealId),
        };
      }
      await queryClient.invalidateQueries({ queryKey: [DEAL_LIST_QUERY_ROOT] });
      router.refresh();
      return true;
    },
    [router, reportError, queryClient],
  );

  const bulkArchive = useCallback(
    async (
      dealIds: string[],
      expectedWriteVersions: Record<string, string>,
    ): Promise<BulkClientResult> => {
      const r = await dealClientResult(() =>
        archiveDealsAction({ dealIds, archived: true, expectedWriteVersions }, readCsrfToken()),
      );
      if (!r.ok) {
        reportError(r.error.id);
        if (r.error.id === ERROR_IDS.DEAL_PRECONDITION)
          await queryClient.invalidateQueries({ queryKey: [DEAL_LIST_QUERY_ROOT] });
        return false;
      }
      if (r.rows.some((row) => row.outcome !== "applied")) {
        reportError(ERROR_IDS.DEAL_BULK_ARCHIVE_PARTIAL);
        await queryClient.invalidateQueries({ queryKey: [DEAL_LIST_QUERY_ROOT] });
        router.refresh();
        return {
          appliedDealIds: r.rows
            .filter((row) => row.outcome === "applied")
            .map((row) => row.dealId),
        };
      }
      await queryClient.invalidateQueries({ queryKey: [DEAL_LIST_QUERY_ROOT] });
      router.refresh();
      return true;
    },
    [router, reportError, queryClient],
  );

  const unarchive = useCallback(
    (dealId: string, expectedWriteVersion: string): void => {
      void dealClientResult(() =>
        archiveDealAction({ dealId, archived: false, expectedWriteVersion }, readCsrfToken()),
      ).then((r) => {
        if (r.ok) router.refresh();
        else reportError(r.error.id);
      });
    },
    [router, reportError],
  );

  return { bulkStage, bulkArchive, unarchive };
}
