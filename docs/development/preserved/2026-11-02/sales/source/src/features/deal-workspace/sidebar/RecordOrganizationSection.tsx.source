"use client";

import { useRouter } from "next/navigation";
import type React from "react";
import type { Organization } from "@/db/schema";
import { InlineCustomFieldEditor } from "@/features/custom-fields/InlineCustomFieldEditor";
import { isCustomFieldValueEmpty } from "@/features/custom-fields/render";
import type { InlineSaveFn } from "@/features/inline-edit/useInlineEditField";
import type { CustomFieldDef } from "@/types/customFields";
import { CollapsibleSection } from "../CollapsibleSection";
import type { CustomFieldsSave } from "./customFieldsSave";
import { DetailsBlock } from "./DetailsBlock";
import { FieldRow } from "./FieldRow";
import { OrganizationSection } from "./OrganizationSection";
import { SectionHeaderMenu, type SectionHeaderMenuItem } from "./SectionHeaderMenu";

type CustomFieldsPersistence =
  | { customFieldsMode?: "deal"; onSaveCustomFields: CustomFieldsSave; writeVersion: string }
  | {
      customFieldsMode: "alternate";
      onSaveCustomFields: InlineSaveFn<Record<string, unknown>>;
      writeVersion?: never;
    };

export function RecordOrganizationSection(
  props: {
    hidden: boolean;
    initiallyCollapsed?: boolean;
    org: Organization | null;
    orgMenuItems: SectionHeaderMenuItem[];
    bulkEditing: boolean;
    onStartBulk: () => void;
    onExitBulk: () => void;
    hiddenOrgFields: ReadonlySet<string>;
    organizationCustomFieldDefs: CustomFieldDef[];
    currency: string;
    customFields: Record<string, unknown>;
    customFieldDefs: CustomFieldDef[];
    detailsTitle: string;
    detailsMenuItems: SectionHeaderMenuItem[];
  } & CustomFieldsPersistence,
): React.ReactNode {
  const {
    hidden,
    initiallyCollapsed = false,
    org,
    orgMenuItems,
    bulkEditing,
    onStartBulk,
    onExitBulk,
    hiddenOrgFields,
    organizationCustomFieldDefs,
    currency,
    customFields,
    customFieldDefs,
    detailsTitle,
    detailsMenuItems,
  } = props;
  if (hidden) return null;

  // Alternate entity saves opt in explicitly; a missing deal version must keep the deal guard.
  const detailsBlock =
    customFieldDefs.length === 0 ? null : props.customFieldsMode === "alternate" ? (
      <AlternateDetailsBlock
        onSave={props.onSaveCustomFields}
        customFieldDefs={customFieldDefs}
        customFields={customFields}
        currency={currency}
      />
    ) : (
      <DetailsBlock
        onSave={props.onSaveCustomFields}
        writeVersion={props.writeVersion}
        customFieldDefs={customFieldDefs}
        customFields={customFields}
        currency={currency}
      />
    );

  if (org !== null) {
    return (
      <OrganizationSection
        org={org}
        defaultOpen={!initiallyCollapsed}
        menuItems={orgMenuItems}
        bulkEditing={bulkEditing}
        onStartBulk={onStartBulk}
        onExitBulk={onExitBulk}
        hidden={hiddenOrgFields}
        customFieldDefs={organizationCustomFieldDefs}
        currency={currency}
        showLabels
      >
        {detailsBlock}
      </OrganizationSection>
    );
  }

  if (customFieldDefs.length > 0) {
    return (
      <CollapsibleSection
        title={detailsTitle}
        headerActions={() => (
          <SectionHeaderMenu sectionLabel={detailsTitle} menuItems={detailsMenuItems} />
        )}
      >
        {detailsBlock}
      </CollapsibleSection>
    );
  }

  return null;
}

function AlternateDetailsBlock({
  onSave,
  customFieldDefs,
  customFields,
  currency,
}: {
  onSave: InlineSaveFn<Record<string, unknown>>;
  customFieldDefs: CustomFieldDef[];
  customFields: Record<string, unknown>;
  currency: string;
}): React.ReactNode {
  const router = useRouter();

  async function save(key: string, value: unknown) {
    const result = await onSave({ [key]: value });
    if (result.ok) router.refresh();
    return result;
  }

  return customFieldDefs.map((def) => {
    const value = customFields[def.key];
    return (
      <FieldRow key={def.id} label={def.name} empty={isCustomFieldValueEmpty(value)}>
        <InlineCustomFieldEditor
          def={def}
          value={value}
          currency={currency}
          onSave={(draft) => save(def.key, draft)}
        />
      </FieldRow>
    );
  });
}
