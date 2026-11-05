"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { type CompanyOverview, companyCommandSchema, companyOverviewSchema } from "../contracts";
import { useCompanyMessages } from "../messages";
import { CommandFeedback } from "./CommandFeedback";
import { DetailsFields } from "./DetailsFields";
import { rebaseDraft } from "./rebaseDraft";
import { useDepartureGuard } from "./useDepartureGuard";
import { useProfileCommand } from "./useProfileApi";
export function DetailsEditor({
  data,
  actorId,
  reload,
}: {
  data: CompanyOverview;
  actorId: string;
  reload: () => Promise<void>;
}) {
  const m = useCompanyMessages();
  const router = useRouter();
  const [draft, setDraft] = useState(data.details);
  const [baseline, setBaseline] = useState(data.details);
  const [revision, setRevision] = useState(data.detailsRevision);
  const command = useProfileCommand(
    `company:${data.workspaceScope}:${actorId}:details`,
    companyCommandSchema,
    companyOverviewSchema,
    "/api/company-profile",
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useDepartureGuard(dirty || command.command !== null, m.unsaved);
  const accept = (result: CompanyOverview | null) => {
    if (result) {
      setDraft(result.details);
      setBaseline(result.details);
      setRevision(result.detailsRevision);
      try {
        router.refresh();
      } catch {
        /* The server already acknowledged the company details. */
      }
    }
  };
  return (
    <div className="space-y-5">
      <DetailsFields
        key={revision}
        value={draft}
        onChange={setDraft}
        disabled={command.busy || command.command !== null || !data.capabilities.manageProfile}
      />
      <div className="rounded-lg bg-muted/30 p-4 text-sm">
        <p className="font-medium">
          {m.baseCurrency}: <bdi>{data.baseCurrency}</bdi>
        </p>
        <p className="mt-1 text-muted-foreground">{m.currencyHint}</p>
      </div>
      <div className="rounded-lg border p-4 text-sm">
        <Link className="font-medium text-primary underline" href="/settings/company/work-profile">
          {m.workProfile}
        </Link>
        <p className="mt-1 text-muted-foreground">{m.workHint}</p>
      </div>
      {data.detailsRevision > revision ? (
        <div className="space-y-2 rounded-md border p-4 text-sm">
          <p>{m.errorConflict}</p>
          <p>
            {m.companyName}: {data.details.companyName}
          </p>
          <Button
            variant="outline"
            disabled={command.command !== null}
            onClick={() => {
              setDraft(rebaseDraft(baseline, draft, data.details));
              setRevision(data.detailsRevision);
              setBaseline(data.details);
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
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => void reload()} disabled={command.busy}>
          {m.refresh}
        </Button>
        <Button
          disabled={
            !dirty || command.busy || command.command !== null || !data.capabilities.manageProfile
          }
          onClick={() => {
            void command
              .run({
                action: "save_details",
                requestId: crypto.randomUUID(),
                expectedRevision: revision,
                details: draft,
              })
              .then(accept);
          }}
        >
          {command.busy ? m.saving : m.save}
        </Button>
      </div>
    </div>
  );
}
