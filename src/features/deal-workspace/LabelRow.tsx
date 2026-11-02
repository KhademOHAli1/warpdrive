"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import { useMemo, useState } from "react";
import { ERROR_IDS } from "@/constants/errorIds";
import { dealClientResult } from "@/features/deals/dealClientResult";
import { updateDealAction } from "@/features/deals/updateAction";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { CatalogLabelPicker } from "@/features/labels/CatalogLabelPicker";
import { resolveLabelChips } from "@/features/labels/resolveLabels";
import { trpc } from "@/lib/trpc-client";
import { useSyncedState } from "@/lib/useSyncedState";
import { readCsrfToken } from "@/utils/csrfCookie";
import { useDealActionError } from "./DealActionErrorProvider";

// Inline label editor for the deal-sidebar Summary section. Wraps the shared LabelToggle and
// commits each change through updateDealAction under the CAS precondition (expectedWriteVersion).
// Advance labels and their token together from the successful final server snapshot.
export function LabelRow({
  dealId,
  expectedWriteVersion,
  labels,
}: {
  dealId: string;
  expectedWriteVersion: string;
  labels: string[];
}): React.ReactNode {
  const translateSales = useAppTranslations("sales");

  const router = useRouter();
  const reportError = useDealActionError();
  // Both re-seed from the server once a router.refresh() delivers new props.
  const incoming = useMemo(
    () => ({ labels, version: expectedWriteVersion }),
    [labels, expectedWriteVersion],
  );
  const [snapshot, setSnapshot] = useSyncedState(incoming);
  const current = snapshot.labels;
  const expected = snapshot.version;
  const [pending, setPending] = useState(false);
  const [stale, setStale] = useState(false);
  const catalog = trpc.labels.listByTarget.useQuery({ target: "deal" }).data ?? [];

  async function onChange(next: string[]): Promise<void> {
    if (pending) return;
    setPending(true);
    const previous = snapshot;
    setSnapshot({ labels: next, version: expected }); // optimistic until the final acknowledgment
    const r = await dealClientResult(() =>
      updateDealAction({ dealId, expectedWriteVersion: expected, labels: next }, readCsrfToken()),
    );
    setPending(false);
    if (r.ok) {
      setStale(false);
      setSnapshot({ labels: r.deal.labels, version: r.deal.writeVersion });
      router.refresh();
      return;
    }
    setSnapshot(previous); // restore the complete prior snapshot, including its token
    // CAS-fail (E_DEAL_002 = DEAL_PRECONDITION): the deal moved under us. Surface a stale hint and
    // refresh so the row reloads the server-true labels and expectedWriteVersion on the next render.
    if (r.error.id === ERROR_IDS.DEAL_PRECONDITION) {
      setStale(true);
      router.refresh();
      return;
    }
    // Any other failure (a non-owner hitting E_PERM_001, a dead session) used to revert with no
    // explanation. Surface the shared modal so the reverted toggle reads as "denied", not "flaky".
    reportError(r.error.id);
  }

  // Active labels render as solid chips (colored from the catalog); the catalog dropdown picker
  // sits alongside them, matching the person/org header control.
  const chips = resolveLabelChips(catalog, current);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map((chip) => (
          <span
            key={chip.name}
            className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${chip.classes}`}
          >
            <bdi dir="auto">{chip.name}</bdi>
          </span>
        ))}
        <CatalogLabelPicker
          target="deal"
          value={current}
          onChange={(next) => void onChange(next)}
        />
      </div>
      {stale ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {translateSales("labels_changed_elsewhere_reloaded_062f9")}
        </p>
      ) : null}
    </div>
  );
}
