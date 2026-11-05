"use client";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  type CompanyBrandingInput,
  type CompanyOverview,
  companyCommandSchema,
  companyOverviewSchema,
} from "../contracts";
import { useCompanyMessages } from "../messages";
import { assetUrl } from "../readiness";
import { AssetChooser } from "./AssetChooser";
import { CommandFeedback } from "./CommandFeedback";
import { ChoiceField, Section, TextField } from "./Fields";
import { rebaseDraft } from "./rebaseDraft";
import { useDepartureGuard } from "./useDepartureGuard";
import { useProfileCommand } from "./useProfileApi";
export function BrandingEditor({
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
  const initial: CompanyBrandingInput = {
    iconAssetId: data.branding.iconAssetId,
    logoAssetId: data.branding.logoAssetId,
    accentColor: data.branding.accentColor,
    fit: data.branding.fit,
  };
  const [draft, setDraft] = useState(initial);
  const [baseline, setBaseline] = useState(initial);
  const [urls, setUrls] = useState({ icon: data.branding.iconUrl, logo: data.branding.logoUrl });
  const [revision, setRevision] = useState(data.brandingRevision);
  const command = useProfileCommand(
    `company:${data.workspaceScope}:${actorId}:branding`,
    companyCommandSchema,
    companyOverviewSchema,
    "/api/company-profile",
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  useDepartureGuard(dirty || command.command !== null, m.unsaved);
  const accept = (result: CompanyOverview | null) => {
    if (result) {
      const value = {
        iconAssetId: result.branding.iconAssetId,
        logoAssetId: result.branding.logoAssetId,
        accentColor: result.branding.accentColor,
        fit: result.branding.fit,
      };
      setDraft(value);
      setBaseline(value);
      setRevision(result.brandingRevision);
      setUrls({ icon: result.branding.iconUrl, logo: result.branding.logoUrl });
      try {
        router.refresh();
      } catch {
        /* The branding save is already acknowledged. */
      }
    }
  };
  const locked = command.busy || command.command !== null;
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{m.brandingHint}</p>
      <Section title={m.branding}>
        {(["icon", "logo"] as const).map((slot) => (
          <div className="space-y-3" key={slot}>
            <AssetChooser
              slot={slot}
              scope={`company:${data.workspaceScope}:${actorId}`}
              disabled={locked}
              uploaded={(asset) => {
                setDraft((current) => ({ ...current, [`${slot}AssetId`]: asset.assetId }));
                setUrls((current) => ({ ...current, [slot]: asset.url }));
              }}
            />
            <Button
              variant="ghost"
              disabled={locked || draft[`${slot}AssetId`] === null}
              onClick={() => {
                setDraft({ ...draft, [`${slot}AssetId`]: null });
                setUrls({ ...urls, [slot]: null });
              }}
            >
              {m.remove}
            </Button>
          </div>
        ))}
        <TextField
          label={m.accentColor}
          value={draft.accentColor ?? ""}
          maxLength={7}
          disabled={locked}
          onChange={(accentColor) =>
            setDraft({ ...draft, accentColor: accentColor === "" ? null : accentColor })
          }
        />
        <ChoiceField
          label={m.fit}
          value={draft.fit}
          options={[
            { value: "contain", label: m.contain },
            { value: "cover", label: m.cover },
          ]}
          disabled={locked}
          onChange={(fit) => {
            if (fit === "contain" || fit === "cover") setDraft({ ...draft, fit });
          }}
        />
      </Section>
      <div className="grid gap-4 sm:grid-cols-2">
        {[false, true].map((dark) => (
          <div
            key={String(dark)}
            className={`space-y-4 rounded-lg border p-5 ${dark ? "bg-slate-950 text-white" : "bg-white text-slate-950"}`}
          >
            <p className="text-sm font-medium">{dark ? m.darkPreview : m.lightPreview}</p>
            <div className="flex items-center gap-3">
              <div
                className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border text-lg font-semibold"
                style={{
                  backgroundColor: /^#[a-f\d]{6}$/i.test(draft.accentColor ?? "")
                    ? (draft.accentColor ?? undefined)
                    : undefined,
                }}
              >
                {urls.icon !== null ? (
                  <Image
                    src={urls.icon}
                    alt={m.icon}
                    width={48}
                    height={48}
                    unoptimized
                    style={{ objectFit: draft.fit }}
                    className="h-full w-full"
                  />
                ) : (
                  data.details.companyName.slice(0, 2).toUpperCase()
                )}
              </div>
              <bdi>{data.details.companyName}</bdi>
            </div>
            {urls.logo !== null ? (
              <Image
                src={urls.logo}
                alt={m.logo}
                width={200}
                height={72}
                unoptimized
                style={{ objectFit: draft.fit }}
                className="h-18 max-w-full"
              />
            ) : null}
          </div>
        ))}
      </div>
      {data.brandingRevision > revision ? (
        <div className="space-y-2">
          <p className="text-sm">{m.errorConflict}</p>
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => {
              const merged = rebaseDraft(baseline, draft, initial);
              setDraft(merged);
              setBaseline(initial);
              setUrls({ icon: assetUrl(merged.iconAssetId), logo: assetUrl(merged.logoAssetId) });
              setRevision(data.brandingRevision);
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
        <Button variant="outline" disabled={locked} onClick={() => void reload()}>
          {m.refresh}
        </Button>
        <Button
          disabled={locked || !dirty}
          onClick={() => {
            void command
              .run({
                action: "save_branding",
                requestId: crypto.randomUUID(),
                expectedRevision: revision,
                branding: draft,
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
