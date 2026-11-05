"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  type CompanyOverview,
  companyCommandSchema,
  companyOverviewSchema,
  payerPreferencesSchema,
} from "../contracts";
import { useCompanyMessages } from "../messages";
import { CommandFeedback } from "./CommandFeedback";
import { ContactRows } from "./ContactRows";
import { ChoiceField, Section, TextField } from "./Fields";
import { rebaseDraft } from "./rebaseDraft";
import { useDepartureGuard } from "./useDepartureGuard";
import { useProfileCommand } from "./useProfileApi";
export function PayerPreferencesEditor({ data, scope }: { data: CompanyOverview; scope: string }) {
  const m = useCompanyMessages();
  const initial = data.payerPreferences ?? payerPreferencesSchema.parse({});
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [revision, setRevision] = useState(data.payerRevision ?? 0);
  const command = useProfileCommand(
    `${scope}:payer`,
    companyCommandSchema,
    companyOverviewSchema,
    "/api/company-profile",
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const locked = command.busy || command.command !== null;
  useDepartureGuard(dirty || command.command !== null, m.unsaved);
  const accept = (value: CompanyOverview | null) => {
    if (value?.payerPreferences) {
      setDraft(value.payerPreferences);
      setBaseline(value.payerPreferences);
      setRevision(value.payerRevision ?? 0);
    }
  };
  return (
    <details className="rounded-lg border p-5">
      <summary className="cursor-pointer text-sm font-semibold">{m.payer}</summary>
      <div className="mt-4 space-y-4">
        <Section title={m.payer} description={m.payerHint}>
          <ChoiceField
            label={m.legal}
            value={draft.payerLegalEntityId ?? ""}
            options={[
              { value: "", label: m.none },
              ...data.legalEntities
                .filter((entity) => !entity.archived)
                .map((entity) => ({ value: entity.id, label: entity.data.legalName })),
            ]}
            disabled={locked}
            onChange={(id) => setDraft({ ...draft, payerLegalEntityId: id || null })}
          />
          {(
            [
              "billingEmail",
              "purchaseOrderReference",
              "electronicInvoiceAddress",
              "electronicInvoiceScheme",
            ] as const
          ).map((key) => (
            <TextField
              key={key}
              label={m[key]}
              value={draft[key]}
              disabled={locked}
              maxLength={300}
              onChange={(value) => setDraft({ ...draft, [key]: value })}
            />
          ))}
        </Section>
        {(["financeContact", "procurementContact"] as const).map((key) => (
          <Section key={key} title={key === "financeContact" ? m.finance : m.procurement}>
            <ContactRows
              value={draft[key] === null ? [] : [draft[key]]}
              disabled={locked}
              onChange={(value) => setDraft({ ...draft, [key]: value.at(-1) ?? null })}
            />
          </Section>
        ))}
        {data.payerRevision !== null && data.payerRevision > revision ? (
          <div className="space-y-2">
            <p className="text-sm">{m.errorConflict}</p>
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => {
                setDraft(rebaseDraft(baseline, draft, initial));
                setBaseline(initial);
                setRevision(data.payerRevision ?? 0);
              }}
            >
              {m.review}
            </Button>
          </div>
        ) : null}
        <CommandFeedback
          state={command}
          retry={() => {
            void command.retry().then(accept);
          }}
          discard={command.discard}
          cancel={() => {
            void command.cancel().then(accept);
          }}
        />
        <Button
          disabled={!dirty || locked}
          onClick={() => {
            void command
              .run({
                action: "save_payer_preferences",
                requestId: crypto.randomUUID(),
                expectedRevision: revision,
                preferences: draft,
              })
              .then(accept);
          }}
        >
          {command.busy ? m.saving : m.save}
        </Button>
      </div>
    </details>
  );
}
