"use client";

import { Download, FilePlus, PackageCheck, Trash2 } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select, type SelectOption } from "@/components/ui/Select";
import { useLocale, useNumberingSystem } from "@/features/i18n/LocaleProvider";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { cn } from "@/lib/utils";
import type { InventoryItem } from "../../contracts";
import type { EngineeringChangeAccess, EngineeringChangeWorkspace } from "../changes/contracts";
import { createEngineeringChangeFixture, type EngineeringFixtureActor } from "../changes/fixture";
import { EngineeringChangePanel } from "../changes/ui/EngineeringChangePanel";
import type {
  ManufacturingRelease,
  ReleaseArtifact,
  ReleaseArtifactKind,
  ReleaseFixtureCommand,
  ReleaseFixtureError,
  ReleaseFixtureState,
} from "../contracts";
import { applyReleaseFixture, createReleaseFixture, missingReleaseArtifacts } from "../fixtures";
import type { ExportIntakeAccess, ExportIntakeResult } from "../intake/contracts";
import { createExportIntakeFixture } from "../intake/fixture";
import { ExportIntakePanel } from "../intake/ui/ExportIntakePanel";
import { manufacturingReleaseMessages } from "./manufacturingReleaseMessages";

type Labels = (typeof manufacturingReleaseMessages)["en"];
type ProductReleaseState = Record<string, ReleaseFixtureState>;
type EngineeringState = { effectiveRevision: string | null; controlled: boolean };

function engineeringActorKey(actor: EngineeringFixtureActor | undefined) {
  return actor === undefined
    ? null
    : JSON.stringify([
        actor.id,
        actor.name,
        actor.canView,
        actor.canPropose,
        actor.canDecide,
        [...actor.visibleSites].sort(),
        [...actor.dispositionSites].sort(),
      ]);
}
type FixtureContext = {
  products: ProductReleaseState;
  save: (itemId: string, state: ReleaseFixtureState) => void;
  register: (item: Pick<InventoryItem, "id" | "sku">, state: ReleaseFixtureState) => void;
  intakeAccess?: ExportIntakeAccess;
  canEditIntake: boolean;
  engineeringAccess?: EngineeringChangeAccess;
  engineeringStates: Record<string, EngineeringState>;
  canEditRelease: boolean;
  canApproveRelease: boolean;
  effectiveRevision: (itemId: string, fallback: string | null) => string | null;
  hasChangeControl: (itemId: string) => boolean;
};

const FixtureContext = createContext<FixtureContext | null>(null);

const releaseFixtureId = (itemId: string, revision: string) => `${itemId}:${revision}`;

function createReleaseFixtureStore(persist: (itemId: string, state: ReleaseFixtureState) => void) {
  const registry = new Map<string, { sku: string; state: ReleaseFixtureState }>();
  const intake = createExportIntakeFixture({
    failFirstReady: true,
    getTargetState(target) {
      const product = registry.get(target.itemId);
      if (
        product?.sku !== target.sku ||
        target.releaseId !== releaseFixtureId(target.itemId, target.revision)
      )
        return null;
      const release = product.state.releases.find(({ revision }) => revision === target.revision);
      return release?.status === "released" ? "approved" : (release?.status ?? null);
    },
  });
  const unavailable = (): Promise<ExportIntakeResult<never>> =>
    Promise.resolve({ ok: false, issues: [{ code: "unavailable" }] });
  function save(itemId: string, state: ReleaseFixtureState) {
    const product = registry.get(itemId);
    if (product !== undefined) registry.set(itemId, { ...product, state });
    persist(itemId, state);
  }
  const engineering = createEngineeringChangeFixture({
    product: (itemId) => registry.get(itemId),
    sealPackage(itemId, candidate, approvedAt) {
      const product = registry.get(itemId);
      if (product === undefined || !product.state.releases.includes(candidate)) return false;
      save(itemId, {
        ...product.state,
        releases: product.state.releases.map((release) =>
          release === candidate
            ? { ...release, status: "released", releasedAt: approvedAt }
            : release,
        ),
      });
      return true;
    },
  });
  return {
    intake,
    engineering,
    save,
    readOnly: {
      list: intake.list,
      submit: unavailable,
      retry: unavailable,
    } satisfies ExportIntakeAccess,
    register: (item: Pick<InventoryItem, "id" | "sku">, state: ReleaseFixtureState) => {
      if (!registry.has(item.id)) registry.set(item.id, { sku: item.sku, state });
    },
  };
}

export function ManufacturingReleaseFixtureProvider({
  children,
  canEditIntake,
  engineeringActor,
}: {
  children: ReactNode;
  canEditIntake?: boolean;
  engineeringActor?: EngineeringFixtureActor;
}) {
  const [products, setProducts] = useState<ProductReleaseState>({});
  // Route revalidation can supply the same permissions in a new object.
  const key = engineeringActorKey(engineeringActor);
  const [previous, setPrevious] = useState({ key, actor: engineeringActor });
  const scope = previous.key === key ? previous : { key, actor: engineeringActor };
  if (scope !== previous) setPrevious(scope);
  const { actor } = scope;
  const [engineeringStates, setEngineeringStates] = useState<Record<string, EngineeringState>>({});
  const [fixture] = useState(() =>
    createReleaseFixtureStore((itemId, state) =>
      setProducts((current) => ({ ...current, [itemId]: state })),
    ),
  );
  const engineeringAccess = useMemo<EngineeringChangeAccess | undefined>(() => {
    if (actor === undefined) return undefined;
    const access = fixture.engineering.access(() => actor);
    function reflect(workspace: EngineeringChangeWorkspace) {
      const id = workspace.itemId;
      const effectiveRevision = workspace.effectiveRelease?.revision ?? null;
      const controlled = fixture.engineering.hasChangeControl(id);
      setEngineeringStates((states) => {
        const prior = states[id];
        if (prior?.effectiveRevision === effectiveRevision && prior.controlled === controlled)
          return states;
        return { ...states, [id]: { effectiveRevision, controlled } };
      });
    }
    return {
      ...access,
      async read(itemId, signal) {
        const result = await access.read(itemId, signal);
        if (result.ok && signal?.aborted !== true) reflect(result.value);
        return result;
      },
      async execute(command) {
        const result = await access.execute(command);
        if (result.ok) reflect(result.value);
        return result;
      },
    };
  }, [actor, fixture]);
  const context = useMemo<FixtureContext>(
    () => ({
      products,
      save: fixture.save,
      register: fixture.register,
      intakeAccess:
        canEditIntake === undefined ? undefined : canEditIntake ? fixture.intake : fixture.readOnly,
      canEditIntake: canEditIntake === true,
      engineeringAccess,
      engineeringStates,
      canEditRelease: actor?.canPropose ?? true,
      canApproveRelease: actor?.canDecide ?? true,
      effectiveRevision: fixture.engineering.effectiveRevision,
      hasChangeControl: fixture.engineering.hasChangeControl,
    }),
    [products, fixture, canEditIntake, engineeringAccess, engineeringStates, actor],
  );
  return <FixtureContext.Provider value={context}>{children}</FixtureContext.Provider>;
}

export function ManufacturingReleasesFixture({ item }: { item: InventoryItem }) {
  const context = useContext(FixtureContext);
  if (context === null) return null;
  return <ProductReleaseFixture key={item.id} item={item} store={context} />;
}

type Feedback =
  | { type: "success"; action: ReleaseFixtureCommand["type"] }
  | { type: "failure"; error: ReleaseFixtureError };

type RunRelease = (command: ReleaseFixtureCommand) => ReleaseFixtureState | null;

function ProductReleaseFixture({ item, store }: { item: InventoryItem; store: FixtureContext }) {
  const t = manufacturingReleaseMessages[useLocale()];
  const headingId = useId();
  const [initial] = useState(() => createReleaseFixture(item));
  const { register } = store;
  useLayoutEffect(() => {
    register(item, initial);
  }, [initial, item, register]);
  const state = store.products[item.id] ?? initial;
  const engineering = store.engineeringStates[item.id];
  const activeRevision =
    engineering?.controlled === true ? engineering.effectiveRevision : state.activeRevision;
  const [requestedRevision, setRequestedRevision] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const selected =
    state.releases.find(({ revision }) => revision === (requestedRevision ?? activeRevision)) ??
    state.releases[0];

  const run: RunRelease = (command) => {
    if (command.type === "approve" && !store.canApproveRelease) return null;
    if (command.type !== "approve" && command.type !== "previewBuild" && !store.canEditRelease)
      return null;
    if (command.type === "approve" && store.hasChangeControl(item.id)) {
      setFeedback({ type: "failure", error: "changeControlRequired" });
      return null;
    }
    const current =
      command.type === "previewBuild"
        ? { ...state, activeRevision: store.effectiveRevision(item.id, state.activeRevision) }
        : state;
    const result = applyReleaseFixture(current, command);
    if (!result.ok) {
      setFeedback({ type: "failure", error: result.error });
      return null;
    }
    const next =
      command.type === "previewBuild"
        ? { ...result.value, activeRevision: state.activeRevision }
        : result.value;
    store.save(item.id, next);
    setFeedback({ type: "success", action: command.type });
    return next;
  };

  function selectRevision(revision: string) {
    setRequestedRevision(revision);
    setFeedback(null);
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn(BLOCK_CLASS, "ph-no-capture min-w-0 space-y-4 p-4")}
    >
      <div className="space-y-1">
        <h3 id={headingId} className="text-sm font-semibold">
          {t.heading}
        </h3>
        <p className="text-xs text-muted-foreground">{t.localFixture}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
        <div className="min-w-0">
          <h4 className="text-xs font-medium text-muted-foreground">{t.activeRelease}</h4>
          {activeRevision !== null ? (
            <bdi className="break-all text-sm font-semibold">
              {t.shortRevision} {activeRevision}
            </bdi>
          ) : (
            <p className="text-sm">{t.noActiveRelease}</p>
          )}
        </div>
        {activeRevision !== null && (
          <Button variant="outline" size="sm" onClick={() => run({ type: "previewBuild" })}>
            <PackageCheck className="size-4" aria-hidden="true" /> {t.previewBuild}
          </Button>
        )}
      </div>
      {feedback?.type === "failure" && (
        <p className="text-sm text-destructive" role="alert">
          {t.errors[feedback.error]}
        </p>
      )}
      {feedback?.type === "success" && (
        <p className="text-sm text-success" role="status">
          {t.notices[feedback.action]}
        </p>
      )}
      <ReleaseHistory
        releases={state.releases}
        selectedRevision={selected?.revision}
        selectRevision={selectRevision}
        t={t}
      />
      {store.canEditRelease && (
        <CreateDraftForm
          t={t}
          create={(value) => {
            const revision = value.trim().toUpperCase();
            if (run({ type: "createDraft", revision }) === null) return false;
            setRequestedRevision(revision);
            return true;
          }}
        />
      )}
      {selected !== undefined && (
        <ReleasePackage
          key={selected.revision}
          release={selected}
          item={item}
          run={run}
          t={t}
          intakeAccess={store.intakeAccess}
          canEditIntake={store.canEditIntake}
          canEditDraft={store.canEditRelease}
          canApproveManually={store.canApproveRelease && engineering?.controlled !== true}
        />
      )}
      {store.engineeringAccess !== undefined && (
        <EngineeringChangePanel access={store.engineeringAccess} itemId={item.id} />
      )}
      <BuildPins builds={state.builds} selectRevision={selectRevision} t={t} />
    </section>
  );
}

function ReleaseHistory({
  releases,
  selectedRevision,
  selectRevision,
  t,
}: {
  releases: ReleaseFixtureState["releases"];
  selectedRevision: string | undefined;
  selectRevision: (revision: string) => void;
  t: Labels;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-2 border-t pt-3">
      <h4 id={headingId} className="text-sm font-semibold">
        {t.history}
      </h4>
      {releases.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noReleases}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {releases.map((release) => (
            <li key={release.revision} className="min-w-0">
              <Button
                variant={release.revision === selectedRevision ? "default" : "outline"}
                size="sm"
                aria-label={`${t.shortRevision} ${release.revision}`}
                aria-pressed={release.revision === selectedRevision}
                onClick={() => selectRevision(release.revision)}
                className="max-w-full whitespace-normal break-all"
              >
                <bdi>
                  {t.shortRevision} {release.revision}
                </bdi>
                {release.status === "draft" && <Badge variant="secondary">{t.draft}</Badge>}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CreateDraftForm({ t, create }: { t: Labels; create: (revision: string) => boolean }) {
  const inputId = useId();
  const [revision, setRevision] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (create(revision)) setRevision("");
      }}
    >
      <label htmlFor={inputId} className="grid min-w-20 flex-1 gap-1 text-xs font-medium">
        {t.revision}
        <Input
          id={inputId}
          maxLength={20}
          required
          value={revision}
          onChange={(event) => setRevision(event.target.value)}
        />
      </label>
      <Button type="submit" variant="outline" size="sm">
        {t.createDraft}
      </Button>
    </form>
  );
}

function ReleasePackage({
  release,
  item,
  run,
  t,
  intakeAccess,
  canEditIntake,
  canEditDraft,
  canApproveManually,
}: {
  release: ManufacturingRelease;
  item: Pick<InventoryItem, "id" | "sku">;
  run: RunRelease;
  t: Labels;
  intakeAccess?: ExportIntakeAccess;
  canEditIntake: boolean;
  canEditDraft: boolean;
  canApproveManually: boolean;
}) {
  const headingId = useId();
  const missingId = useId();
  const isDraft = release.status === "draft";
  const missing = missingReleaseArtifacts(release);

  return (
    <section aria-labelledby={headingId} className="space-y-3 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="text-sm font-semibold">
          {t.packageFiles} ·{" "}
          <bdi>
            {t.shortRevision} {release.revision}
          </bdi>
        </h4>
        <Badge variant={isDraft ? "secondary" : "success"}>{isDraft ? t.draft : t.released}</Badge>
      </div>
      <ReleaseArtifactRows
        artifacts={release.artifacts}
        t={t}
        remove={
          isDraft && canEditDraft
            ? (artifactId) =>
                run({ type: "removeArtifact", revision: release.revision, artifactId })
            : undefined
        }
      />
      {isDraft && canEditDraft && <DraftArtifactForm revision={release.revision} run={run} t={t} />}
      <ExportIntakePanel
        access={intakeAccess}
        canEdit={isDraft && canEditIntake}
        target={{
          itemId: item.id,
          releaseId: releaseFixtureId(item.id, release.revision),
          sku: item.sku,
          revision: release.revision,
        }}
      />
      {isDraft && (
        <>
          {missing.length > 0 && (
            <p id={missingId} className="text-sm text-muted-foreground">
              {t.missingFiles} · {missing.map((kind) => t.kinds[kind]).join(", ")}
            </p>
          )}
          {canApproveManually && (
            <Button
              size="sm"
              aria-describedby={missing.length > 0 ? missingId : undefined}
              disabled={missing.length > 0}
              onClick={() => run({ type: "approve", revision: release.revision })}
            >
              {t.approve}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

const acceptFileExtension: Partial<Record<ReleaseArtifactKind, string>> = {
  pcbFabrication: ".zip",
  manufacturingBom: ".csv",
};

function DraftArtifactForm({ revision, run, t }: { revision: string; run: RunRelease; t: Labels }) {
  const fileId = useId();
  const [kind, setKind] = useState<ReleaseArtifactKind>("pcbFabrication");
  const options: SelectOption[] = Object.entries(t.kinds).map(([value, label]) => ({
    value,
    label,
  }));
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem("releaseArtifact");
        if (!(input instanceof HTMLInputElement)) return;
        const file = input.files?.[0];
        if (file === undefined) return;
        if (run({ type: "addArtifact", revision, kind, file }) !== null) input.value = "";
      }}
    >
      <div className="grid gap-1">
        <span className="text-xs font-medium">{t.fileRole}</span>
        <Select
          value={kind}
          onChange={(value) => setKind(value as ReleaseArtifactKind)}
          options={options}
          ariaLabel={t.fileRole}
          contentClassName={BLOCK_CLASS}
        />
      </div>
      <label className="grid min-w-0 gap-1 text-xs font-medium" htmlFor={fileId}>
        {t.productionFile}
        <Input
          id={fileId}
          type="file"
          name="releaseArtifact"
          accept={acceptFileExtension[kind]}
          required
        />
      </label>
      <Button type="submit" variant="outline" size="sm">
        <FilePlus className="size-4" aria-hidden="true" /> {t.addFile}
      </Button>
    </form>
  );
}

function downloadArtifact(artifact: ReleaseArtifact) {
  const url = URL.createObjectURL(artifact.bytes);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReleaseArtifactRows({
  artifacts,
  t,
  remove,
}: {
  artifacts: ReleaseArtifact[];
  t: Labels;
  remove?: (id: string) => void;
}) {
  const locale = useLocale();
  const numberingSystem = useNumberingSystem();
  const size = new Intl.NumberFormat(locale, { numberingSystem, style: "unit", unit: "byte" });
  if (artifacts.length === 0) {
    return <p className="text-sm text-muted-foreground">{t.noFiles}</p>;
  }
  return (
    <ul className="divide-y rounded-md border px-2">
      {artifacts.map((artifact) => (
        <li key={artifact.id} className="flex items-center justify-between gap-1.5 py-1.5">
          <div className="min-w-0">
            <bdi className="block break-all text-sm">{artifact.name}</bdi>
            <span className="text-xs text-muted-foreground">
              {t.kinds[artifact.kind]} · {size.format(artifact.sizeBytes)}
            </span>
          </div>
          <div className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t.download} ${artifact.name}`}
              onClick={() => downloadArtifact(artifact)}
            >
              <Download className="size-4" aria-hidden="true" />
            </Button>
            {remove !== undefined && (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`${t.remove} ${artifact.name}`}
                onClick={() => remove(artifact.id)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function BuildPins({
  builds,
  selectRevision,
  t,
}: {
  builds: ReleaseFixtureState["builds"];
  selectRevision: (revision: string) => void;
  t: Labels;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-2 border-t pt-3">
      <h4 id={headingId} className="text-sm font-semibold">
        {t.buildPins}
      </h4>
      {builds.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noBuilds}</p>
      ) : (
        <ul className="divide-y text-sm">
          {builds.map(({ id, revision }) => (
            <li key={id}>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto w-full flex-wrap justify-between py-1.5 font-normal"
                aria-label={t.openBuildRelease(id)}
                onClick={() => selectRevision(revision)}
              >
                <bdi dir="ltr">{id}</bdi>
                <bdi className="font-semibold">
                  {t.shortRevision} {revision}
                </bdi>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
