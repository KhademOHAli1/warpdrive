"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { useCompanyMessages } from "@/features/company-profile/messages";
import { CommandFeedback } from "@/features/company-profile/ui/CommandFeedback";
import { ChoiceField, Section, TextField } from "@/features/company-profile/ui/Fields";
import { ListField } from "@/features/company-profile/ui/ListField";
import { rebaseDraft } from "@/features/company-profile/ui/rebaseDraft";
import { useDepartureGuard } from "@/features/company-profile/ui/useDepartureGuard";
import { useProfileCommand } from "@/features/company-profile/ui/useProfileApi";
import { commandSchema, type Overview, preferencesAckSchema, type WorkKind } from "../contracts";
import { useWorkMessages } from "../messages";
export function PreferencesEditor({
  data,
  actorId,
  changed,
  reload,
}: {
  data: Overview;
  actorId: string;
  changed: () => void;
  reload: () => Promise<void>;
}) {
  const m = useWorkMessages();
  const c = useCompanyMessages();
  const [draft, setDraft] = useState(data.preferences);
  const [baseline, setBaseline] = useState(data.preferences);
  const [revision, setRevision] = useState(data.revision);
  const command = useProfileCommand(
    `work:${data.workspaceScope}:${actorId}:preferences`,
    commandSchema,
    preferencesAckSchema,
    "/api/work-profile",
  );
  const kinds: WorkKind[] = ["vehicle_repair", "design", "it_consulting", "custom"];
  const locked = command.busy || command.command !== null || !data.permissions.manageProfile;
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useDepartureGuard(dirty || command.command !== null, c.unsaved);
  const accept = (result: typeof preferencesAckSchema._output | null) => {
    if (result) {
      setDraft(result.preferences);
      setBaseline(result.preferences);
      setRevision(result.revision);
      changed();
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{m.intro}</p>
      <Section title={m.workTypes}>
        {kinds.map((kind) => (
          <div key={kind} className="flex items-center gap-2 rounded-md border p-3 text-sm">
            <Checkbox
              label={m[kind]}
              checked={draft.workTypes.includes(kind)}
              disabled={locked}
              onCheckedChange={(checked) => {
                const workTypes = checked
                  ? [...draft.workTypes, kind]
                  : draft.workTypes.filter((entry) => entry !== kind);
                setDraft({
                  ...draft,
                  workTypes,
                  primaryWorkType:
                    draft.primaryWorkType !== null && workTypes.includes(draft.primaryWorkType)
                      ? draft.primaryWorkType
                      : (workTypes[0] ?? null),
                });
              }}
            />
            {m[kind]}
          </div>
        ))}
        <ChoiceField
          label={m.primary}
          value={draft.primaryWorkType ?? ""}
          options={[
            { value: "", label: c.unspecified },
            ...draft.workTypes.map((kind) => ({ value: kind, label: m[kind] })),
          ]}
          disabled={locked}
          onChange={(value) =>
            setDraft({ ...draft, primaryWorkType: kinds.find((kind) => kind === value) ?? null })
          }
        />
        <TextField
          label={m.goal}
          value={draft.primaryGoal}
          maxLength={300}
          disabled={locked}
          onChange={(primaryGoal) => setDraft({ ...draft, primaryGoal })}
        />
        <ListField
          label={m.deliveryModels}
          value={draft.deliveryModels}
          disabled={locked}
          max={12}
          onChange={(deliveryModels) => setDraft({ ...draft, deliveryModels })}
        />
        <ListField
          label={m.customers}
          value={draft.customerTypes}
          disabled={locked}
          max={12}
          onChange={(customerTypes) => setDraft({ ...draft, customerTypes })}
        />
      </Section>
      <Section title={m.modules}>
        {(["sales", "contacts", "activities", "work"] as const).map((module) => (
          <div className="flex items-center gap-2 text-sm" key={module}>
            <Checkbox
              label={m[module]}
              checked={draft.modules.includes(module)}
              disabled={locked}
              onCheckedChange={(checked) =>
                setDraft({
                  ...draft,
                  modules: checked
                    ? [...draft.modules, module]
                    : draft.modules.filter((entry) => entry !== module),
                })
              }
            />
            {m[module]}
          </div>
        ))}
      </Section>
      {data.revision > revision ? (
        <div className="space-y-2">
          <p className="text-sm">{c.errorConflict}</p>
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => {
              setDraft(rebaseDraft(baseline, draft, data.preferences));
              setRevision(data.revision);
              setBaseline(data.preferences);
            }}
          >
            {c.review}
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
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={command.busy} onClick={() => void reload()}>
          {c.refresh}
        </Button>
        <Button
          disabled={!dirty || locked}
          onClick={() => {
            void command
              .run({
                action: "save_preferences",
                requestId: crypto.randomUUID(),
                expectedRevision: revision,
                preferences: draft,
              })
              .then(accept);
          }}
        >
          {command.busy ? c.saving : c.save}
        </Button>
      </div>
    </div>
  );
}
