"use client";

import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/SdkDialog";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import type { HiddenBuiltinsMap } from "@/features/import/eligibleFields";
import { sampleValues } from "@/features/import/sampleValues";
import type { WizardState } from "@/features/import/wizardState";
import type { CustomFieldDef } from "@/types/customFields";
import { buildColumnOptions, choiceToValue } from "./columnOptions";

export function MappingReviewDialog({
  state,
  defs,
  hiddenBuiltins,
  busy,
  onStartOver,
}: {
  state: WizardState;
  defs: CustomFieldDef[];
  hiddenBuiltins: HiddenBuiltinsMap;
  busy: boolean;
  onStartOver: () => void;
}) {
  const L = useSettingsMessages();
  const J = L._extra.importJourney;
  const options = buildColumnOptions(state.target, defs, hiddenBuiltins, state.source, L);

  return (
    <Dialog
      onClose={(value) => {
        if (value === "start-over") onStartOver();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />} disabled={busy}>
        {J.reviewMapping}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" initialFocus="content">
        <div className="flex flex-col gap-1.5 pe-10 text-start">
          <DialogTitle>{J.reviewMapping}</DialogTitle>
          <DialogDescription>{J.mappingReadOnlyHint}</DialogDescription>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-start text-sm">
            <thead className="border-b bg-muted/30 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start">{L.importer.column}</th>
                <th className="px-3 py-2 text-start">{L.importer.mapTo}</th>
              </tr>
            </thead>
            <tbody>
              {state.headers.map((header) => {
                const choice = state.columns[header];
                const label =
                  choice === undefined
                    ? L.importer.unmapped
                    : (options.find((option) => option.value === choiceToValue(choice))?.label ??
                      L.importer.unmapped);
                return (
                  <tr key={header} className="border-t">
                    <td className="px-3 py-3 align-top">
                      <bdi className="font-medium [overflow-wrap:anywhere]">{header}</bdi>
                      {sampleValues(state.rows, header).map((value, index) => (
                        <bdi
                          // biome-ignore lint/suspicious/noArrayIndexKey: immutable source preview values can repeat
                          key={`${header}-${index}`}
                          className="mt-1 block text-xs text-muted-foreground [overflow-wrap:anywhere]"
                        >
                          {value}
                        </bdi>
                      ))}
                    </td>
                    <td className="px-3 py-3 align-top">{label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DialogClose render={<Button variant="outline" />} disabled={busy} value="start-over">
          {L.importer.startOver}
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
