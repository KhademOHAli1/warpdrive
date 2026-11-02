"use server";

import { ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { guardCsrf } from "@/features/identity/actions/shared";
import { SIG } from "@/features/identity/actions/sig";
import { createContext } from "@/server/trpc/context";
import { archiveDeal } from "./archiveDeal";
import {
  archiveDeals,
  type BulkArchiveInput,
  type BulkArchiveRow,
  bulkArchiveInput,
} from "./bulkArchive";
import { type DealActionSnapshot, dealActionSnapshot, missingDealVersion } from "./dealVersion";

export type ArchiveResult =
  | { ok: true; deal: DealActionSnapshot }
  | { ok: false; error: { id: string } };

export type BulkArchiveResult =
  | {
      ok: true;
      count: number;
      rows: Array<Omit<BulkArchiveRow, "deal"> & { deal?: DealActionSnapshot }>;
    }
  | { ok: false; error: { id: string } };

export async function archiveDealAction(
  input: { dealId: string; archived?: boolean; expectedWriteVersion: string },
  csrfToken: string | null = null,
): Promise<ArchiveResult> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };

  const r = await archiveDeal(
    db,
    actor,
    {
      dealId: input.dealId,
      archived: input.archived ?? true,
      expectedWriteVersion: input.expectedWriteVersion,
    },
    SIG(),
  );
  if (!r.ok) return { ok: false, error: { id: r.error.id } };
  return { ok: true, deal: dealActionSnapshot(r.value) };
}

export async function archiveDealsAction(
  input: BulkArchiveInput,
  csrfToken: string | null = null,
): Promise<BulkArchiveResult> {
  const csrfOk = await guardCsrf(csrfToken);
  if (!csrfOk.ok) return { ok: false, error: { id: "E_AUTH_CSRF" } };
  const { actor } = await createContext();
  if (actor === null) return { ok: false, error: { id: ERROR_IDS.AUTH_SESSION_DEAD } };

  const versionError = missingDealVersion(input, ["expectedWriteVersions"]);
  if (versionError !== null) return { ok: false, error: { id: versionError.id } };
  const parsed = bulkArchiveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: { id: ERROR_IDS.DEAL_BULK_INPUT_INVALID } };
  const r = await archiveDeals(db, actor, parsed.data, SIG());
  if (!r.ok) return { ok: false, error: { id: r.error.id } };
  return {
    ok: true,
    count: r.value.count,
    rows: r.value.rows.map(({ deal, ...row }) => ({
      ...row,
      ...(deal === undefined ? {} : { deal: dealActionSnapshot(deal) }),
    })),
  };
}
