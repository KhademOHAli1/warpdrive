"use client";
import { useCompanyMessages } from "@/features/company-profile/messages";
import { ChoiceField, Section, TextField } from "@/features/company-profile/ui/Fields";
import type { ItemDraft, WorkFieldDefinition, WorkOptions, WorkType } from "../contracts";
import { useWorkMessages } from "../messages";

function CustomValue({
  field,
  value,
  changed,
  disabled,
}: {
  field: WorkFieldDefinition;
  value: ItemDraft["values"][string];
  changed: (value: ItemDraft["values"][string]) => void;
  disabled: boolean;
}) {
  const m = useWorkMessages();
  const c = useCompanyMessages();
  const label = `${field.label}${field.required ? " *" : ""}`;
  if (field.type === "boolean")
    return (
      <ChoiceField
        label={label}
        value={value === true ? "yes" : value === false ? "no" : ""}
        options={[
          { value: "", label: c.unspecified },
          { value: "yes", label: m.yes },
          { value: "no", label: m.no },
        ]}
        disabled={disabled}
        onChange={(choice) => changed(choice === "" ? null : choice === "yes")}
      />
    );
  if (field.type === "select")
    return (
      <ChoiceField
        label={label}
        value={typeof value === "string" ? value : ""}
        options={[
          { value: "", label: c.unspecified },
          ...field.options.map((option) => ({ value: option, label: option })),
        ]}
        disabled={disabled}
        onChange={changed}
      />
    );
  return (
    <TextField
      label={label}
      value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
      multiline={field.type === "long_text"}
      maxLength={10000}
      disabled={disabled}
      onChange={(entry) =>
        changed(
          field.type === "number"
            ? entry === ""
              ? null
              : Number(entry)
            : entry === ""
              ? null
              : entry,
        )
      }
    />
  );
}
export function ItemFields({
  value: v,
  types,
  options,
  onChange,
  disabled,
  existing,
}: {
  value: ItemDraft;
  types: WorkType[];
  options: WorkOptions;
  onChange: (value: ItemDraft) => void;
  disabled: boolean;
  existing: boolean;
}) {
  const m = useWorkMessages();
  const c = useCompanyMessages();
  const type = types.find((entry) => entry.id === v.typeId);
  const patch = (next: Partial<ItemDraft>) => onChange({ ...v, ...next });
  const reference = (
    key: "organizationId" | "personId" | "dealId",
    label: string,
    choices: { id: string; name: string }[],
  ) => (
    <ChoiceField
      key={key}
      label={label}
      value={v[key] ?? ""}
      options={[
        { value: "", label: c.none },
        ...choices.map((entry) => ({ value: entry.id, label: entry.name })),
      ]}
      disabled={disabled}
      onChange={(value) => patch({ [key]: value || null })}
    />
  );
  return (
    <div className="space-y-5">
      <Section title={m.workflow}>
        <ChoiceField
          label={m.workflow}
          value={v.typeId}
          options={types
            .filter((entry) => !entry.isArchived || entry.id === v.typeId)
            .map((entry) => ({ value: entry.id, label: entry.name }))}
          disabled={disabled || existing}
          onChange={(typeId) => {
            const chosen = types.find((entry) => entry.id === typeId);
            if (chosen)
              patch({
                typeId,
                stageId: chosen.stages.find((stage) => !stage.isArchived)?.id ?? "",
                values: {},
              });
          }}
        />
        <ChoiceField
          label={m.stage}
          value={v.stageId}
          options={
            type?.stages
              .filter((entry) => !entry.isArchived || entry.id === v.stageId)
              .map((entry) => ({ value: entry.id, label: entry.name })) ?? []
          }
          disabled={disabled}
          onChange={(stageId) => patch({ stageId })}
        />
        <TextField
          label={m.itemTitle}
          value={v.title}
          maxLength={240}
          disabled={disabled}
          onChange={(title) => patch({ title })}
        />
        <TextField
          label={m.description}
          value={v.description}
          multiline
          maxLength={20000}
          disabled={disabled}
          onChange={(description) => patch({ description })}
        />
        <ChoiceField
          label={m.owner}
          value={v.ownerId}
          options={options.owners.map((entry) => ({ value: entry.id, label: entry.name }))}
          disabled={disabled}
          onChange={(ownerId) => patch({ ownerId })}
        />
        <TextField
          label={m.dueDate}
          value={v.dueDate ?? ""}
          type="date"
          disabled={disabled}
          onChange={(dueDate) => patch({ dueDate: dueDate || null })}
        />
      </Section>
      {type && type.fields.length > 0 ? (
        <Section title={m.fields}>
          {type.fields.map((field) => (
            <CustomValue
              key={field.key}
              field={field}
              value={v.values[field.key] ?? null}
              disabled={disabled}
              changed={(value) => patch({ values: { ...v.values, [field.key]: value } })}
            />
          ))}
        </Section>
      ) : null}
      <Section title={m.contacts} description={m.linkedHint}>
        {reference("organizationId", m.organization, options.organizations)}
        {reference("personId", m.person, options.persons)}
        {reference(
          "dealId",
          m.deal,
          options.deals.map((entry) => ({ id: entry.id, name: entry.title })),
        )}
      </Section>
      <Section title={m.visibility}>
        <ChoiceField
          label={m.visibility}
          value={v.visibility}
          options={[
            { value: "owner", label: m.ownerOnly },
            { value: "all", label: m.all },
            { value: "group", label: m.visibilityGroup },
          ]}
          disabled={disabled}
          onChange={(visibility) => {
            if (visibility === "owner" || visibility === "all" || visibility === "group")
              patch({
                visibility,
                visibilityGroupId: visibility === "group" ? (options.groups[0]?.id ?? null) : null,
              });
          }}
        />
        {v.visibility === "group" ? (
          <ChoiceField
            label={m.visibilityGroup}
            value={v.visibilityGroupId ?? ""}
            options={options.groups.map((entry) => ({ value: entry.id, label: entry.name }))}
            disabled={disabled}
            onChange={(visibilityGroupId) => patch({ visibilityGroupId })}
          />
        ) : null}
      </Section>
    </div>
  );
}
