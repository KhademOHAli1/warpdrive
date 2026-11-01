"use client";

import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  LABEL_COLORS,
  LABEL_TARGETS,
  type LabelColor,
  type LabelTarget,
} from "@/constants/labelColors";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { LabelColorSelect } from "./LabelColorSelect";
import { LabelRow } from "./LabelRow";
import { type LabelCatalogRow, useLabelCatalog } from "./useLabelCatalog";

export function LabelsClient({ rows: initial }: { rows: LabelCatalogRow[] }): React.ReactNode {
  const L = useSettingsMessages();
  const catalog = useLabelCatalog(initial);
  const [addName, setAddName] = useState<Partial<Record<LabelTarget, string>>>({});
  const [addColor, setAddColor] = useState<Partial<Record<LabelTarget, LabelColor>>>({});
  const targets: Record<LabelTarget, string> = {
    deal: L.targetDeal,
    person: L.targetPerson,
    organization: L.targetOrganization,
    lead: L.targetLead,
  };

  async function add(target: LabelTarget): Promise<void> {
    const name = (addName[target] ?? "").trim();
    if (name !== "" && (await catalog.add(target, name, addColor[target] ?? LABEL_COLORS[0]))) {
      setAddName((current) => ({ ...current, [target]: "" }));
    }
  }

  return (
    <div className="space-y-6">
      {catalog.error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {catalog.error}
        </p>
      )}
      {(catalog.pending || catalog.saved) && (
        <p role="status" className="text-sm text-muted-foreground">
          {catalog.pending ? L._extra.saving : L.saved}
        </p>
      )}
      {LABEL_TARGETS.map((target) => {
        const group = catalog.rows.filter((row) => row.target === target);
        const ids = group.map((row) => row.id);
        return (
          <section key={target} className="space-y-2">
            <h2 className="text-sm font-semibold">{targets[target]}</h2>
            <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-sm">
              {group.map((row, index) => (
                <LabelRow
                  key={row.id}
                  row={row}
                  isFirst={index === 0}
                  isLast={index === group.length - 1}
                  pending={catalog.pending}
                  onMove={(direction) => void catalog.move(target, ids, index, direction)}
                  onRename={(name) => catalog.rename(row.id, name)}
                  onColor={(color) => void catalog.color(row.id, color)}
                  onDelete={() => void catalog.remove(row.id)}
                />
              ))}
              {group.length === 0 && (
                <li className="px-4 py-3 text-sm text-muted-foreground">{L.emptyList}</li>
              )}
              <li className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
                <label
                  htmlFor={`new-${target}-label`}
                  className="col-span-2 block min-w-0 sm:col-span-1"
                >
                  <span className="mb-1 block text-sm font-medium">{L.labelName}</span>
                  <Input
                    id={`new-${target}-label`}
                    aria-label={`${targets[target]} ${L.labelName}`}
                    required
                    maxLength={120}
                    value={addName[target] ?? ""}
                    disabled={catalog.pending}
                    onChange={(event) =>
                      setAddName((current) => ({ ...current, [target]: event.target.value }))
                    }
                  />
                </label>
                <div className="w-32 max-w-full">
                  <span className="mb-1 block text-sm font-medium">{L.color}</span>
                  <LabelColorSelect
                    ariaLabel={`${targets[target]} ${L.color}`}
                    value={addColor[target] ?? LABEL_COLORS[0]}
                    disabled={catalog.pending}
                    onChange={(color) =>
                      setAddColor((current) => ({ ...current, [target]: color }))
                    }
                  />
                </div>
                <Button
                  size="sm"
                  className="self-end"
                  disabled={catalog.pending || (addName[target] ?? "").trim() === ""}
                  onClick={() => void add(target)}
                >
                  {L.addLabel}
                </Button>
              </li>
            </ul>
          </section>
        );
      })}
    </div>
  );
}
