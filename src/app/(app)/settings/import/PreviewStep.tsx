"use client";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { formatImportDiagnostic } from "@/features/import/diagnosticFormatter";
import type { ImportTarget } from "@/features/import/wizardState";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import type { CustomFieldDef } from "@/types/customFields";
import { ImportQueryFeedback } from "./ImportQueryFeedback";

export interface PreviewStepProps {
  batchId: string;
  validation: { valid: number; invalid: number };
  busy: boolean;
  onCommit: () => void;
  target?: ImportTarget;
  defs?: readonly CustomFieldDef[];
}

export function PreviewStep({
  batchId,
  validation,
  busy,
  onCommit,
  target,
  defs,
}: PreviewStepProps): React.ReactNode {
  const L = useSettingsMessages();
  const IMP = L.importer;
  const preferences = useLocalePreferences();
  const format = useFormatters();

  const query = trpc.import.listRows.useQuery({ batchId });
  const invalid = query.data?.filter((r) => r.status === "invalid") ?? [];

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-sm font-medium tabular-nums text-emerald-700">
          {IMP.valid(validation.valid)}
        </span>
        {validation.invalid > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-sm font-medium tabular-nums text-red-700">
            {IMP.withErrors(validation.invalid)}
          </span>
        )}
      </div>

      {(query.data === undefined || query.isError) && (
        <ImportQueryFeedback
          loadingLabel={L._extra.importJourney.loadingRows}
          failed={query.isError}
          retrying={query.isFetching}
          onRetry={() => void query.refetch()}
        />
      )}

      {invalid.length > 0 && (
        <div className="space-y-1.5">
          <h2 className="text-sm font-medium">{IMP.rowErrors}</h2>
          <ul className="divide-y rounded-md border text-sm">
            {invalid.map((r) => (
              <li key={r.id} className="px-3 py-2">
                <span className="font-medium tabular-nums">#{format.number(r.rowNumber)}</span>{" "}
                <span className="text-red-600">
                  {r.errors
                    .map((e) => formatImportDiagnostic(e, { ...preferences, target, defs }))
                    .join("; ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Button
        type="button"
        disabled={validation.valid === 0 || busy || query.data === undefined || query.isError}
        onClick={onCommit}
        size="sm"
      >
        {IMP.commitButton(validation.valid)}
      </Button>
    </section>
  );
}
