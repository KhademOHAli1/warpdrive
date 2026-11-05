"use client";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { type CompanyOverview, companyCommandSchema, type LegalEntity } from "../contracts";
import { CompanyLookupPanel } from "../lookup/CompanyLookupPanel";
import { useCompanyMessages } from "../messages";
import { CommandFeedback, ProfileError } from "./CommandFeedback";
import { LegalEntityEditor } from "./LegalEntityEditor";
import { PayerPreferencesEditor } from "./PayerPreferencesEditor";
import { useProfileCommand } from "./useProfileApi";

const archiveSchema = z.object({
  id: z.uuid(),
  revision: z.number().int(),
  archived: z.literal(true),
});
function ArchiveEntity({
  entity,
  scope,
  archived,
}: {
  entity: LegalEntity;
  scope: string;
  archived: () => void;
}) {
  const m = useCompanyMessages();
  const command = useProfileCommand(
    `${scope}:archive:${entity.id}`,
    companyCommandSchema,
    archiveSchema,
    "/api/company-profile",
  );
  const accept = (value: z.infer<typeof archiveSchema> | null) => {
    if (value) archived();
  };
  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        disabled={command.busy || entity.archived || command.command !== null}
        onClick={() => {
          void command
            .run({
              action: "archive_legal_entity",
              requestId: crypto.randomUUID(),
              expectedRevision: entity.revision,
              id: entity.id,
            })
            .then(accept);
        }}
      >
        {m.archive}
      </Button>
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
    </div>
  );
}
export function LegalManager({
  data,
  actorId,
  reload,
}: {
  data: CompanyOverview;
  actorId: string;
  reload: () => Promise<void>;
}) {
  const m = useCompanyMessages();
  const [editing, setEditing] = useState<{ entity: LegalEntity | null } | null>(null);
  const [saved, setSaved] = useState<LegalEntity[]>([]);
  const [archivedIds, setArchivedIds] = useState<string[]>([]);
  if (!data.capabilities.manageLegal) return <ProfileError code="forbidden" />;
  const scope = `company:${data.workspaceScope}:${actorId}`;
  const records = new Map(data.legalEntities.map((entity) => [entity.id, entity]));
  for (const entity of saved)
    if ((records.get(entity.id)?.revision ?? -1) <= entity.revision) records.set(entity.id, entity);
  const entities = [...records.values()].map((entity) =>
    archivedIds.includes(entity.id) ? { ...entity, archived: true } : entity,
  );
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{m.legalHint}</p>
      <CompanyLookupPanel scope={scope} onApplied={reload} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => void reload()}>
          {m.refresh}
        </Button>
        <Button onClick={() => setEditing({ entity: null })}>{m.newEntity}</Button>
      </div>
      <div className="space-y-3">
        {entities.map((entity) => (
          <article
            key={entity.id}
            className="flex flex-wrap justify-between gap-4 rounded-lg border p-4"
          >
            <div>
              <h3 className="font-medium">{entity.data.legalName}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                <bdi>{entity.data.country}</bdi>
                {entity.archived ? ` · ${m.archived}` : ""}
              </p>
              <p className="mt-2 max-w-md text-xs text-muted-foreground">
                {entity.readiness.status === "ready" ? m.identityComplete : m.identityIncomplete}
              </p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">{m.identityOnly}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={entity.archived}
                onClick={() => setEditing({ entity })}
              >
                {m.review}
              </Button>
              <ArchiveEntity
                entity={entity}
                scope={scope}
                archived={() => setArchivedIds([...archivedIds, entity.id])}
              />
            </div>
          </article>
        ))}
      </div>
      <PayerPreferencesEditor data={{ ...data, legalEntities: entities }} scope={scope} />
      {editing ? (
        <LegalEntityEditor
          entity={editing.entity}
          latest={entities.find((entity) => entity.id === editing.entity?.id) ?? null}
          reload={reload}
          entities={entities}
          scope={scope}
          close={() => setEditing(null)}
          saved={(entity) => setSaved([...saved.filter((entry) => entry.id !== entity.id), entity])}
        />
      ) : null}
    </div>
  );
}
