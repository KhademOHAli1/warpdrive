"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  const [open, setOpen] = useState(false);
  const options = buildColumnOptions(state.target, defs, hiddenBuiltins, state.source, L);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {J.reviewMapping}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{J.reviewMapping}</DialogTitle>
          <DialogDescription>{J.mappingReadOnlyHint}</DialogDescription>
        </DialogHeader>
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
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            onStartOver();
          }}
        >
          {L.importer.startOver}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
