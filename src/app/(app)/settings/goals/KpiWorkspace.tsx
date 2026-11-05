"use client";

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  CirclePlus,
  Copy,
  Layers3,
  Plus,
  Search,
  Target,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Goal } from "@/db/schema/goals";
import { type KpiPack, type KpiTemplate, kpiPacks } from "@/features/goals/kpiCatalog";
import { useKpiHubMessages } from "@/features/goals/kpiHubMessages";
import { useKpiMessages } from "@/features/goals/kpiMessages";
import type {
  KpiDefinition,
  KpiGoalResult,
  KpiScheme,
  KpiWorkspace as WorkspaceData,
} from "@/features/goals/kpiModel";
import { KpiResults, useKpiPresentation } from "@/features/goals/ui/KpiResults";
import { useKpiWorkspace } from "@/features/goals/ui/useKpiWorkspace";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { SettingsHeading } from "../SettingsHeading";
import { GoalsClient } from "./GoalsClient";
import { KpiBuilder } from "./KpiBuilder";
import {
  KpiMeasurementForm,
  KpiPackForm,
  KpiSchemeAssignForm,
  KpiSchemeForm,
} from "./KpiSchemeForm";
import type { Option } from "./types";

type Modal =
  | {
      kind: "builder";
      template?: KpiTemplate;
      definition?: KpiDefinition;
      revision?: KpiDefinition;
    }
  | { kind: "scheme"; initial?: KpiScheme; duplicate?: boolean }
  | { kind: "apply"; scheme: KpiScheme }
  | { kind: "measurement"; row: KpiGoalResult }
  | { kind: "pack"; pack: KpiPack };
interface Props {
  goals: Goal[];
  users: Option[];
  teams: Option[];
  pipelines: Option[];
  activityTypes: Option[];
  baseCurrency: string;
  today: string;
}

function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed bg-muted/10 px-6 py-12 text-center">
      <div className="mb-4 flex size-11 items-center justify-center rounded-xl border bg-card text-muted-foreground">
        <Target aria-hidden className="size-5" />
      </div>
      <h3 className="text-base font-medium tracking-tight">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-5">{action}</div>
    </div>
  );
}

function getModalTitle(modal: Modal | null, S: ReturnType<typeof useKpiHubMessages>): string {
  switch (modal?.kind) {
    case "builder":
      return modal.definition ? S.assign : modal.revision ? S.revise : S.newKpi;
    case "scheme":
      return modal.initial && modal.duplicate !== true ? S.revise : S.newScorecard;
    case "apply":
      return S.apply;
    case "pack":
      return S.packCreate;
    case "measurement":
    case undefined:
      return S.recordMeasurement;
  }
}

function getModalDescription(modal: Modal | null, S: ReturnType<typeof useKpiHubMessages>): string {
  switch (modal?.kind) {
    case "measurement":
      return modal.row.definition.name;
    case "apply":
      return modal.scheme.name;
    case "scheme":
      return S.schemeNote;
    case "pack":
      return S.packNote;
    case "builder":
      return modal.definition || modal.revision ? S.versionNotice : S.customBody;
    case undefined:
      return S.description;
  }
}

function KpiLibrary({
  onTemplates,
  data,
  search,
  setSearch,
  source,
  setSource,
  open,
}: {
  onTemplates: () => void;
  data: WorkspaceData | null;
  search: string;
  setSearch: (v: string) => void;
  source: string;
  setSource: (v: string) => void;
  open: (v: Modal) => void;
}): ReactNode {
  const S = useKpiHubMessages();
  const B = useKpiMessages();
  const format = useFormatters();
  const { locale } = useLocalePreferences();
  const definitions = data?.definitions ?? [];
  const matches = definitions.filter(
    (d) =>
      (source === "all" || d.source === source) &&
      `${d.name} ${d.description}`
        .toLocaleLowerCase(locale)
        .includes(search.toLocaleLowerCase(locale)),
  );
  return (
    <TabsContent value="library" className="space-y-5 pt-5">
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-48 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-2.5 size-4 text-muted-foreground"
          />
          <Input
            aria-label={S.search}
            placeholder={S.search}
            className="min-h-10 ps-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          ariaLabel={S.source}
          value={source}
          onChange={setSource}
          triggerClassName="min-h-10 w-48"
          options={["all", "deals", "activities", "manual"].map((v) => ({
            value: v,
            label: S[v as "all"],
          }))}
        />
      </div>
      {data &&
        (definitions.length === 0 ? (
          <Empty
            title={S.emptyLibrary}
            body={S.emptyLibraryBody}
            action={
              <Button variant="outline" onClick={onTemplates}>
                {S.chooseTemplate}
                <ArrowRight aria-hidden className="size-4" />
              </Button>
            }
          />
        ) : matches.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{S.noMatches}</p>
        ) : (
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {matches.map((d) => (
              <article key={d.id} className="flex flex-wrap items-center gap-4 p-5">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/20 text-muted-foreground">
                  <ChartNoAxesCombined aria-hidden className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-sm font-semibold">{d.name}</h3>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    {d.description}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {B.sources[d.source]} · {B.calculations[d.calculation]} · {S.revision}{" "}
                    {format.number(d.revision)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => open({ kind: "builder", definition: d })}
                  >
                    {S.assign}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => open({ kind: "builder", revision: d })}
                  >
                    {S.revise}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${S.duplicate}: ${d.name}`}
                    onClick={() =>
                      open({
                        kind: "builder",
                        template: {
                          id: d.id,
                          name: d.name,
                          description: d.description,
                          requiredData: d.source === "manual" ? S.manualNote : S.readScope,
                          definition: { ...d, name: `${d.name} · ${S.duplicate}` },
                          condition: { kind: "at_least", target: "1" },
                        },
                      })
                    }
                  >
                    <Copy aria-hidden className="size-3.5" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ))}
    </TabsContent>
  );
}

function KpiScorecards({
  data,
  open,
}: {
  data: WorkspaceData | null;
  open: (v: Modal) => void;
}): ReactNode {
  const S = useKpiHubMessages();
  const format = useFormatters();
  const presentation = useKpiPresentation();
  const definitions = data?.definitions ?? [];
  return (
    <TabsContent value="scorecards" className="space-y-5 pt-5">
      <div className="flex justify-end">
        <Button
          variant="outline"
          onClick={() => open({ kind: "scheme" })}
          disabled={!definitions.length}
        >
          <Plus aria-hidden className="size-4" />
          {S.newScorecard}
        </Button>
      </div>
      {data &&
        (data.schemes.length === 0 ? (
          <Empty
            title={S.emptyScorecards}
            body={S.emptyScorecardsBody}
            action={
              <Button
                variant="outline"
                disabled={!definitions.length}
                onClick={() => open({ kind: "scheme" })}
              >
                {S.newScorecard}
              </Button>
            }
          />
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {data.schemes.map((s) => (
              <article key={s.id} className="rounded-xl border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="break-words text-base font-medium tracking-tight">{s.name}</h3>
                  <span className="text-xs text-muted-foreground">
                    {S.revision} {format.number(s.revision)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {s.description}
                </p>
                <ul className="my-4 divide-y border-y">
                  {s.entries.map((e) => {
                    const d =
                      definitions.find((d) => d.id === e.definitionId) ??
                      data.referencedDefinitions?.find((d) => d.id === e.definitionId) ??
                      data.goals.find((r) => r.definition.id === e.definitionId)?.definition;
                    return (
                      <li
                        key={e.definitionId}
                        className="flex flex-wrap justify-between gap-2 py-3 text-xs"
                      >
                        <span className="font-medium">{d?.name ?? S.definition}</span>
                        <span className="text-muted-foreground">
                          {d ? presentation.condition(e.condition, d) : S.versionNotice}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => open({ kind: "apply", scheme: s })}>
                    {S.apply}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => open({ kind: "scheme", initial: s })}
                  >
                    {S.revise}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${S.duplicate}: ${s.name}`}
                    onClick={() =>
                      open({
                        kind: "scheme",
                        initial: { ...s, name: `${s.name} · ${S.duplicate}` },
                        duplicate: true,
                      })
                    }
                  >
                    <Copy aria-hidden className="size-3.5" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ))}
    </TabsContent>
  );
}

function KpiTemplates({
  packs,
  pack,
  setPack,
  open,
}: {
  packs: KpiPack[];
  pack: KpiPack | null;
  setPack: (v: KpiPack | null) => void;
  open: (v: Modal) => void;
}): ReactNode {
  const S = useKpiHubMessages();
  return (
    <TabsContent value="templates" className="space-y-5 pt-5">
      <p className="text-sm leading-relaxed text-muted-foreground">{S.packNote}</p>
      {pack === null ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packs.map((p) => (
            <Button
              variant="ghost"
              type="button"
              key={p.id}
              onClick={() => setPack(p)}
              className="group flex w-full flex-col items-start gap-0 rounded-xl border bg-card p-5 text-start font-normal whitespace-normal outline-none transition-colors hover:border-link/40 hover:bg-muted/10 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <div className="mb-4 flex size-10 items-center justify-center rounded-lg border bg-muted/20 text-muted-foreground">
                <BriefcaseBusiness aria-hidden className="size-4" />
              </div>
              <h3 className="text-sm font-semibold">{p.name}</h3>
              <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">
                {p.description}
              </p>
              <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
                {p.requiredData}
              </p>
              <span className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-link">
                {S.usePack}
                <ArrowRight aria-hidden className="size-3.5" />
              </span>
            </Button>
          ))}
          <Button
            variant="ghost"
            type="button"
            onClick={() => open({ kind: "builder" })}
            className="flex w-full flex-col items-start gap-0 rounded-xl border border-dashed bg-muted/10 p-5 text-start font-normal whitespace-normal outline-none hover:border-link/40 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CirclePlus aria-hidden className="mb-4 size-7 text-muted-foreground" />
            <h3 className="text-sm font-semibold">{S.custom}</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{S.customBody}</p>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => setPack(null)}>
            <ArrowLeft aria-hidden className="size-4" />
            {S.back}
          </Button>
          <div>
            <h3 className="text-xl font-medium tracking-tight">{pack.name}</h3>
            <Button className="mt-4" onClick={() => open({ kind: "pack", pack })}>
              <Layers3 aria-hidden className="size-4" />
              {S.packCreate}
            </Button>
            <p className="mt-2 text-sm text-muted-foreground">{pack.description}</p>
          </div>
          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {pack.templates.map((t) => (
              <article key={t.id} className="flex flex-wrap items-start justify-between gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h4 className="text-sm font-semibold">{t.name}</h4>
                    <span className="rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {t.definition.source === "manual" ? S.dataRequired : S.crm}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t.description}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {t.requiredData}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => open({ kind: "builder", template: t })}
                >
                  {S.useTemplate}
                </Button>
              </article>
            ))}
          </div>
        </div>
      )}
    </TabsContent>
  );
}

export function KpiWorkspace(props: Props): ReactNode {
  const S = useKpiHubMessages();
  const { locale } = useLocalePreferences();
  const format = useFormatters();
  const [on, setOn] = useState(props.today);
  const { data, error, loading, reload } = useKpiWorkspace(on);
  const [tab, setTab] = useState("goals");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [pack, setPack] = useState<KpiPack | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [busy, setBusy] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const open = (next: Modal) => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setModal(next);
  };
  const close = () => setModal(null);
  const done = () => {
    setModal(null);
    void reload();
  };
  const definitions = data?.definitions ?? [];
  const names = Object.fromEntries([...props.users, ...props.teams].map((o) => [o.id, o.name]));
  const packs = kpiPacks(locale, props.baseCurrency);
  const modalTitle = getModalTitle(modal, S);
  // Old revisions pinned by a scorecard remain selectable when its next revision is published.
  const schemeDefinitions =
    modal?.kind === "scheme" && modal.initial
      ? [
          ...definitions,
          ...(data?.referencedDefinitions ?? []),
          ...(data?.goals ?? []).map((r) => r.definition),
        ].filter((d, i, all) => all.findIndex((v) => v.id === d.id) === i)
      : definitions;
  return (
    <div className="space-y-7">
      <SettingsHeading
        scope="workspace"
        title={S.title}
        description={S.description}
        actions={
          <Link href="/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {S.performance}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </Link>
        }
      />
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-5 px-6 py-6">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {S.title}
            </p>
            <h2 className="text-xl font-medium tracking-tight sm:text-2xl">{S.subtitle}</h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {S.customBody}
            </p>
          </div>
          <Button onClick={() => open({ kind: "builder" })}>
            <Plus aria-hidden className="size-4" />
            {S.newKpi}
          </Button>
        </div>
        {data && (
          <dl className="grid grid-cols-3 divide-x border-t bg-muted/10 rtl:divide-x-reverse">
            {[
              [S.goalCount, data.goals.length],
              [S.definitionCount, definitions.length],
              [S.schemeCount, data.schemes.length],
            ].map(([label, count]) => (
              <div key={String(label)} className="min-w-0 px-4 py-4 sm:px-6">
                <dt className="text-xs leading-relaxed text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-xl font-medium tracking-tight tabular-nums">
                  {format.number(Number(count))}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      {error !== null && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-4"
        >
          <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
            {error === "E_KPI_NOT_READY" ? S.notReady : S.failed}
          </p>
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            {S.retry}
          </Button>
        </div>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          {S.loading}
        </p>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto border-b">
          <TabsList className="min-h-12 w-max gap-6">
            {[
              { id: "goals", label: S.goals, Icon: Target },
              { id: "library", label: S.library, Icon: BookOpen },
              { id: "scorecards", label: S.scorecards, Icon: Layers3 },
              { id: "templates", label: S.templates, Icon: BriefcaseBusiness },
            ].map(({ id, label, Icon }) => (
              <TabsTrigger
                key={id}
                value={id}
                className="min-h-11 flex-none gap-2 rounded-none border-0 border-b-2 border-transparent px-2 pb-3 pt-2 text-muted-foreground after:hidden data-[state=active]:border-b-link data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground dark:data-[state=active]:bg-transparent"
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="goals" className="space-y-5 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">{S.readScope}</p>
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{S.asOf}</p>
              <DatePicker ariaLabel={S.asOf} value={on} onChange={(v) => setOn(v ?? on)} />
            </div>
          </div>
          {data &&
            (data.goals.length ? (
              <KpiResults
                rows={data.goals}
                names={names}
                onMeasure={(row) => open({ kind: "measurement", row })}
              />
            ) : (
              <Empty
                title={S.emptyGoals}
                body={S.emptyGoalsBody}
                action={
                  <Button
                    onClick={() => {
                      setTab("library");
                    }}
                    variant="outline"
                  >
                    {S.library}
                    <ArrowRight aria-hidden className="size-4" />
                  </Button>
                }
              />
            ))}
        </TabsContent>
        <KpiLibrary
          onTemplates={() => setTab("templates")}
          data={data}
          search={search}
          setSearch={setSearch}
          source={source}
          setSource={setSource}
          open={open}
        />
        <KpiScorecards data={data} open={open} />
        <KpiTemplates packs={packs} pack={pack} setPack={setPack} open={open} />
      </Tabs>
      <details className="rounded-xl border bg-card">
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {S.legacy}
          {props.goals.length > 0 && ` · ${format.number(props.goals.length)}`}
        </summary>
        <div className="space-y-4 border-t p-5">
          <p className="text-sm leading-relaxed text-muted-foreground">{S.legacyBody}</p>
          <p className="text-xs text-muted-foreground">{S.legacyLimit}</p>
          <GoalsClient {...props} />
        </div>
      </details>
      <Dialog
        open={modal !== null}
        onOpenChange={(value) => {
          if (!value && !busy) close();
        }}
      >
        <DialogContent
          className={
            modal?.kind === "builder"
              ? "max-h-[92dvh] overflow-y-auto sm:max-w-5xl"
              : "max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
          }
          onCloseAutoFocus={(e) => {
            if (returnFocus.current?.isConnected === true) {
              e.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{modalTitle}</DialogTitle>
            <DialogDescription>{getModalDescription(modal, S)}</DialogDescription>
          </DialogHeader>
          {modal?.kind === "builder" && (
            <KpiBuilder
              users={props.users}
              teams={props.teams}
              pipelines={props.pipelines}
              activityTypes={props.activityTypes}
              baseCurrency={props.baseCurrency}
              initial={modal.revision ?? modal.template?.definition}
              initialCondition={
                modal.definition
                  ? data?.goals.find((row) => row.goal.definitionId === modal.definition?.id)?.goal
                      .condition
                  : modal.template?.condition
              }
              sourceRequirement={modal.template?.requiredData}
              definition={modal.definition}
              revision={modal.revision}
              onDone={done}
              onCancel={close}
              onBusyChange={setBusy}
            />
          )}
          {modal?.kind === "scheme" && (
            <KpiSchemeForm
              definitions={schemeDefinitions}
              initial={modal.initial}
              duplicate={modal.duplicate}
              onDone={done}
              onCancel={close}
              onBusyChange={setBusy}
            />
          )}
          {modal?.kind === "apply" && (
            <KpiSchemeAssignForm
              scheme={modal.scheme}
              users={props.users}
              teams={props.teams}
              today={props.today}
              onDone={done}
              onCancel={close}
              onBusyChange={setBusy}
            />
          )}
          {modal?.kind === "pack" && (
            <KpiPackForm
              pack={modal.pack}
              onDone={() => {
                setTab("scorecards");
                done();
              }}
              onCancel={close}
              onBusyChange={setBusy}
            />
          )}
          {modal?.kind === "measurement" && (
            <KpiMeasurementForm
              row={modal.row}
              today={props.today}
              onDone={done}
              onCancel={close}
              onBusyChange={setBusy}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
