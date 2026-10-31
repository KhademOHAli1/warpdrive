"use client";

import type React from "react";
import { useState } from "react";
import { Select } from "@/components/ui/Select";
import { CUSTOM_FIELD_TARGETS, type CustomFieldTarget } from "@/constants/customFieldTypes";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";
import { BuiltinFieldRow } from "./BuiltinFieldRow";
import { CreateFieldDialog } from "./CreateFieldDialog";
import { FieldList } from "./FieldList";
import type { BuiltinRow, FieldRow } from "./types";

export function DataFieldsClient({
  byTarget,
  builtinByTarget = {},
  initialTarget = "deal",
}: {
  byTarget: Record<string, FieldRow[]>;
  builtinByTarget?: Record<string, BuiltinRow[]>;
  initialTarget?: CustomFieldTarget;
}): React.ReactNode {
  const S = useSettingsMessages();
  const targetLabels: Record<CustomFieldTarget, string> = {
    deal: S.entityDeal,
    lead: S.entityLead,
    person: S.entityPerson,
    organization: S.entityOrganization,
    activity: S.entityActivity,
  };
  const [target, setTarget] = useState<CustomFieldTarget>(initialTarget);
  const [created, setCreated] = useState(false);
  const builtinRows = builtinByTarget[target] ?? [];

  return (
    <SettingsPage>
      <SettingsHeading
        scope="workspace"
        title={S.dataFields}
        description={S._fields.description}
        actions={
          <CreateFieldDialog
            target={target}
            entityLabel={targetLabels[target]}
            onCreated={() => setCreated(true)}
          />
        }
      />
      {created && (
        <p role="status" className="text-sm text-muted-foreground">
          {S.saved}
        </p>
      )}
      <div>
        <span className="mb-1 block text-sm font-medium">{S.entity}</span>
        <Select
          ariaLabel={S.entity}
          value={target}
          onChange={(value) => {
            setTarget(value as CustomFieldTarget);
            setCreated(false);
          }}
          options={CUSTOM_FIELD_TARGETS.map((value) => ({ value, label: targetLabels[value] }))}
          triggerContent={targetLabels[target]}
        />
      </div>
      {builtinRows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">{S.builtinFields}</h2>
          <ul className="divide-y overflow-hidden rounded-lg border bg-card shadow-sm">
            {builtinRows.map((row) => (
              <BuiltinFieldRow key={row.key} entity={target} row={row} />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">{S.builtinHideNote}</p>
        </section>
      )}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{S.customFields}</h2>
        <FieldList key={target} rows={byTarget[target] ?? []} footer={null} />
      </section>
    </SettingsPage>
  );
}
