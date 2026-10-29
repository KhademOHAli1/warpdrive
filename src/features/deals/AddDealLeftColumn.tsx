"use client";
import type React from "react";
import { useId } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { Select, type SelectOption } from "@/components/ui/Select";
import { TITLE_MAX_LEN } from "@/constants/fieldLimits";
import { sourceChannelOptions } from "@/constants/sourceChannelLabels";
import { CurrencySelect } from "@/features/currencies/CurrencySelect";
import { EntityCombobox } from "@/features/entity-create/EntityCombobox";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { LabelField } from "@/features/labels/LabelField";
import { useFormatters } from "@/lib/useFormatters";
import type { AddDealState } from "./addDealState";
import { StageChevron } from "./StageChevron";

interface Option {
  id: string;
  name: string;
}
interface PipelineOption extends Option {
  stages: Option[];
}

interface AddDealLeftColumnProps {
  state: AddDealState;
  set: (patch: Partial<AddDealState>) => void;
  // Title edits go through this (not set) so the modal can stop autofilling once the user types.
  // Optional: falls back to a plain title patch when a caller does not need the edit signal.
  onTitleChange?: (value: string) => void;
  people: Option[];
  orgs: Option[];
  pipelines: PipelineOption[];
  stages: Option[]; // stages of the currently selected pipeline
  owners: Option[] | null; // null hides the owner select (actor cannot reassign)
  groups: Option[] | null; // null hides the visible-to select
  baseCurrency: string;
  currency?: string;
  onCurrencyChange?: (currency: string) => void;
  organizationCustomFields?: React.ReactNode;
  dealCustomFields?: React.ReactNode;
}

// Left column of the Add deal dialog (Pipedrive field order): contact/org, title, value, pipeline,
// stage, label, close date, owner, source, visibility. Purely presentational.
export function AddDealLeftColumn(props: AddDealLeftColumnProps): React.ReactNode {
  const translateSales = useAppTranslations("sales");
  const locale = useLocale();
  const format = useFormatters();

  const {
    state,
    set,
    onTitleChange,
    people,
    orgs,
    pipelines,
    stages,
    owners,
    groups,
    baseCurrency,
    organizationCustomFields,
    dealCustomFields,
  } = props;
  const titleId = useId();
  const sourceChannelIdId = useId();
  return (
    <div className="flex flex-col gap-3 text-sm">
      <EntityCombobox
        label={translateSales("contact_person_744c0")}
        options={people}
        placeholder={translateSales("search_or_add_a_person_49385")}
        createLabel={(q) => translateSales("add_arg0_as_new_person_11c06", { arg0: q })}
        similarWarning={translateSales("similar_contact_already_exists_4f208")}
        onSelectExisting={(id) => set({ personMode: "existing", personId: id })}
        onCreateNew={(name) => set({ personMode: "new", personId: "", newPersonName: name })}
        onClear={() => set({ personMode: "existing", personId: "", newPersonName: "" })}
      />

      <EntityCombobox
        label={translateSales("organization_d764d")}
        options={orgs}
        placeholder={translateSales("search_or_add_an_organization_36308")}
        createLabel={(q) => translateSales("add_arg0_as_new_organization_d5252", { arg0: q })}
        similarWarning={translateSales("similar_organization_already_exists_260ac")}
        onSelectExisting={(id) => set({ orgMode: "existing", orgId: id })}
        onCreateNew={(name) => set({ orgMode: "new", orgId: "", newOrgName: name })}
        onClear={() => set({ orgMode: "existing", orgId: "", newOrgName: "" })}
      />

      {state.orgMode === "new" ? organizationCustomFields : null}

      <label className="block" htmlFor={titleId}>
        <span className="mb-1 block font-medium">{translateSales("title_7e8cd")}</span>
        <Input
          id={titleId}
          aria-label={translateSales("deal_title_95b14")}
          value={state.title}
          onChange={(e) =>
            onTitleChange ? onTitleChange(e.target.value) : set({ title: e.target.value })
          }
          placeholder={translateSales("deal_title_95b14")}
          maxLength={TITLE_MAX_LEN}
        />
        <span className="mt-0.5 block text-end text-xs tabular-nums text-muted-foreground">
          {state.title.length}/{TITLE_MAX_LEN}
        </span>
      </label>

      <div>
        <span className="mb-1 block font-medium">{translateSales("value_8e379")}</span>
        <div className="flex gap-2">
          <Input
            aria-label={translateSales("deal_value_9412c")}
            inputMode="decimal"
            value={state.value}
            onChange={(e) => set({ value: e.target.value })}
            placeholder="0"
          />
          <div className="w-44 shrink-0">
            <CurrencySelect
              value={props.currency ?? baseCurrency}
              onChange={props.onCurrencyChange ?? (() => {})}
            />
          </div>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{translateSales("currencyAmountHint")}</p>
      </div>

      <div>
        <span className="mb-1 block font-medium">{translateSales("pipeline_37e1c")}</span>
        <Select
          ariaLabel={translateSales("pipeline_37e1c")}
          value={state.pipelineId}
          onChange={(v) => {
            const next = pipelines.find((p) => p.id === v);
            set({ pipelineId: v, stageId: next?.stages[0]?.id ?? "" });
          }}
          options={pipelines.map<SelectOption>((p) => ({ value: p.id, label: p.name }))}
        />
      </div>

      <div>
        <span className="mb-1 block font-medium">{translateSales("pipeline_stage_8e0c5")}</span>
        <StageChevron
          stages={stages}
          selectedId={state.stageId}
          onSelect={(id) => set({ stageId: id })}
        />
      </div>

      <div className="block">
        <span className="mb-1 block font-medium">{translateSales("labels_934b8")}</span>
        <LabelField target="deal" value={state.labels} onChange={(labels) => set({ labels })} />
      </div>

      <div className="block">
        <span className="mb-1 block font-medium">
          {translateSales("expected_close_date_af65c")}
        </span>
        <DatePicker
          ariaLabel={translateSales("expected_close_date_af65c")}
          value={state.expectedCloseDate === "" ? null : state.expectedCloseDate}
          placeholder={translateSales("set_date_08c6c")}
          triggerClassName="flex h-8 w-full items-center rounded border border-field-border bg-card px-2 text-start text-sm"
          formatLabel={format.dateOnly}
          onChange={(v) => set({ expectedCloseDate: v ?? "" })}
        />
      </div>

      {owners !== null && (
        <div className="block">
          <span className="mb-1 block font-medium">{translateSales("owner_4b1b8")}</span>
          <Combobox
            ariaLabel={translateSales("owner_4b1b8")}
            value={state.ownerId}
            onChange={(id) => set({ ownerId: id })}
            options={[
              { value: "", label: translateSales("computed.me") },
              ...owners.map<ComboboxOption>((u) => ({
                value: u.id,
                label: u.name,
                avatarName: u.name,
              })),
            ]}
          />
        </div>
      )}

      <div>
        <span className="mb-1 block font-medium">{translateSales("source_channel_23f39")}</span>
        <Select
          ariaLabel={translateSales("source_channel_23f39")}
          value={state.sourceChannel}
          onChange={(v) => set({ sourceChannel: v })}
          placeholder={translateSales("computed.noChannel")}
          options={[
            { value: "", label: translateSales("computed.noChannel") },
            ...sourceChannelOptions(locale),
          ]}
        />
      </div>

      <label className="block" htmlFor={sourceChannelIdId}>
        <span className="mb-1 block font-medium">{translateSales("source_channel_id_65b0c")}</span>
        <Input
          id={sourceChannelIdId}
          aria-label={translateSales("source_channel_id_65b0c")}
          value={state.sourceChannelId}
          onChange={(e) => set({ sourceChannelId: e.target.value })}
          placeholder={translateSales("reference_campaign_id_929b6")}
        />
      </label>

      {groups !== null && (
        <div className="block">
          <span className="mb-1 block font-medium">{translateSales("visible_to_eee20")}</span>
          <Select
            ariaLabel={translateSales("visible_to_eee20")}
            value={state.visibilityGroupId}
            onChange={(v) => set({ visibilityGroupId: v })}
            placeholder={translateSales("computed.defaultVisibility")}
            options={[
              { value: "", label: translateSales("computed.defaultVisibility") },
              ...groups.map<SelectOption>((g) => ({ value: g.id, label: g.name })),
            ]}
          />
        </div>
      )}

      {dealCustomFields}
    </div>
  );
}
