"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  Copy,
  MoreHorizontal,
  Plus,
  Search,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Goal } from "@/db/schema/goals";
import { type KpiPack, type KpiTemplate, kpiPacks } from "@/features/goals/kpiCatalog";
import { useKpiHubMessages } from "@/features/goals/kpiHubMessages";
import { useKpiMessages } from "@/features/goals/kpiMessages";
import type { KpiDefinition, KpiGoalResult, KpiScheme } from "@/features/goals/kpiModel";
import { KpiEvidence, useKpiPresentation } from "@/features/goals/ui/KpiResults";
import { useKpiWorkspace } from "@/features/goals/ui/useKpiWorkspace";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";
import { useFormatters } from "@/lib/useFormatters";
import { GoalsClient } from "./GoalsClient";
import { KpiBuilder } from "./KpiBuilder";
import { KpiGraphEditor } from "./KpiGraphEditor";
import {
  KpiMeasurementForm,
  KpiPackForm,
  KpiSchemeAssignForm,
  KpiSchemeForm,
} from "./KpiSchemeForm";
import type { Option } from "./types";

type Modal =
  | { kind: "assign"; definition?: KpiDefinition; template?: KpiTemplate }
  | { kind: "scheme"; initial?: KpiScheme; duplicate?: boolean }
  | { kind: "apply"; scheme: KpiScheme }
  | { kind: "measurement"; row: KpiGoalResult }
  | { kind: "pack"; pack: KpiPack }
  | { kind: "detail"; row: KpiGoalResult };
interface Props {
  goals: Goal[];
  users: Option[];
  teams: Option[];
  pipelines: Option[];
  activityTypes: Option[];
  baseCurrency: string;
  today: string;
}
type WorkspaceCopy = ReturnType<typeof useKpiHubMessages>;

function goalDisplayName(row: KpiGoalResult): string {
  const name = row.goal.name;
  return name === undefined || name === "" ? row.definition.name : name;
}
function workspaceModalTitle(modal: Modal | null, copy: WorkspaceCopy): string {
  if (modal === null) return copy.recordMeasurement;
  switch (modal.kind) {
    case "assign":
      return copy.assign;
    case "scheme":
      return modal.initial !== undefined && modal.duplicate !== true
        ? copy.revise
        : copy.newScorecard;
    case "apply":
      return copy.apply;
    case "pack":
      return copy.packCreate;
    case "detail":
      return goalDisplayName(modal.row);
    case "measurement":
      return copy.recordMeasurement;
  }
}
function workspaceModalDescription(modal: Modal | null, copy: WorkspaceCopy): string {
  if (modal === null) return copy.schemeNote;
  switch (modal.kind) {
    case "detail":
    case "measurement":
      return modal.row.definition.description;
    case "assign":
      return copy.versionNotice;
    case "pack":
      return copy.packNote;
    default:
      return copy.schemeNote;
  }
}

function ListEmpty({ children }: { children: ReactNode }): ReactNode {
  return <p className="border-y py-10 text-center text-sm text-muted-foreground">{children}</p>;
}
function RowMenu({ name, children }: { name: string; children: ReactNode }): ReactNode {
  const S = useKpiHubMessages();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`${S.actions}: ${name}`}>
          <MoreHorizontal aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}
const cell = "px-3 py-2.5";
const rowClass = "border-b last:border-b-0 hover:bg-muted/15";
function ListHead({ labels }: { labels: string[] }): ReactNode {
  return (
    <thead className="border-b bg-muted/20 text-xs text-muted-foreground">
      <tr>
        {labels.map((label) => (
          <th key={label} scope="col" className="px-3 py-2 text-start font-medium">
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function KpiWorkspace(props: Props): ReactNode {
  const S = useKpiHubMessages();
  const B = useKpiMessages();
  const L = useSettingsMessages();
  const { locale } = useLocalePreferences();
  const format = useFormatters();
  const presentation = useKpiPresentation();
  const { data, error, loading, reload } = useKpiWorkspace(props.today);
  const [tab, setTab] = useState("goals");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [pack, setPack] = useState<KpiPack | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [busy, setBusy] = useState(false);
  const [designer, setDesigner] = useState<{ initial?: KpiDefinition; duplicate?: boolean } | null>(
    null,
  );
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
  const matches = (name: string) =>
    name.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale));
  const definitions = data?.definitions ?? [];
  const library = definitions.filter(
    (d) =>
      matches(`${d.name} ${d.description}`) &&
      (source === "all" || (source === "custom" ? Boolean(d.graph) : d.source === source)),
  );
  const packs = kpiPacks(locale, props.baseCurrency);
  const schemeDefinitions = [
    ...definitions,
    ...(data?.referencedDefinitions ?? []),
    ...(data?.goals ?? []).map((r) => r.definition),
  ].filter((d, i, all) => all.findIndex((v) => v.id === d.id) === i);
  const legacyLabel = (g: Goal) =>
    g.subject === "activity"
      ? L._extra.activityGoalDisplayLabel(g.action, L._extra.goalIntervals[g.interval])
      : L._extra.goalDisplayLabel(
          g.metric === "value" ? L._extra.goalDealValue : L._extra.deals,
          L._extra.goalActions[g.action],
          L._extra.goalIntervals[g.interval],
        );
  const searchInput = (
    <div className="relative w-full sm:w-64">
      <Search
        aria-hidden
        className="pointer-events-none absolute start-2.5 top-2 size-3.5 text-muted-foreground"
      />
      <Input
        aria-label={S.search}
        placeholder={S.search}
        className="h-8 ps-8 text-sm"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
    </div>
  );
  const customButton = (
    <Button variant="outline" size="sm" onClick={() => setDesigner({})}>
      <Workflow aria-hidden className="size-3.5" />
      {S.customKpi}
    </Button>
  );
  const title = workspaceModalTitle(modal, S);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{S.title}</h1>
        <Link href="/dashboard" className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {S.performance}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          setSearch("");
        }}
      >
        <div className="overflow-x-auto border-b">
          <TabsList className="h-10 w-max gap-5">
            {[
              {
                id: "goals",
                label: S.goals,
                count: props.goals.length + (data?.goals.length ?? 0),
              },
              { id: "library", label: S.library, count: definitions.length },
              { id: "scorecards", label: S.scorecards, count: data?.schemes.length ?? 0 },
              { id: "templates", label: S.templates },
            ].map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="h-10 flex-none rounded-none border-0 border-b-2 border-transparent px-1 text-sm text-muted-foreground after:hidden data-[state=active]:border-b-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground dark:data-[state=active]:bg-transparent"
              >
                {t.label}
                {t.count !== undefined && (
                  <span aria-hidden className="ms-1.5 text-xs tabular-nums text-muted-foreground">
                    {format.number(t.count)}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="goals" className="pt-3">
          <GoalsClient
            {...props}
            goals={props.goals.filter((g) => matches(legacyLabel(g)))}
            customGoals={(data?.goals ?? []).filter((r) => matches(goalDisplayName(r)))}
            onCustomOpen={(r) => open({ kind: "detail", row: r })}
            pendingCustom={loading}
            customUnavailable={error !== null}
            toolbar={searchInput}
            extraActions={customButton}
          />
        </TabsContent>
        <TabsContent value="library" className="space-y-3 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {searchInput}
              <Select
                ariaLabel={S.source}
                value={source}
                onChange={setSource}
                triggerClassName="h-8 w-40"
                options={[
                  { value: "all", label: S.all },
                  { value: "custom", label: S.customKpi },
                  ...(["deals", "activities", "manual"] as const).map((v) => ({
                    value: v,
                    label: S[v],
                  })),
                ]}
              />
            </div>
            {customButton}
          </div>
          {data &&
            (library.length ? (
              <div className="overflow-x-auto border-y">
                <table className="w-full text-start text-sm">
                  <caption className="sr-only">{S.library}</caption>
                  <ListHead labels={[S.name, S.source, B.calculation, S.revision, S.actions]} />
                  <tbody>
                    {library.map((d) => (
                      <tr className={rowClass} key={d.id}>
                        <td className={`${cell} min-w-52`}>
                          <Button
                            variant="ghost"
                            type="button"
                            className="h-auto min-h-8 justify-start p-0 text-start font-medium hover:bg-transparent outline-none hover:text-link focus-visible:ring-2 focus-visible:ring-ring"
                            onClick={() => open({ kind: "assign", definition: d })}
                          >
                            {d.name}
                          </Button>
                        </td>
                        <td className={`${cell} text-muted-foreground`}>
                          {d.graph ? S.customKpi : B.sources[d.source]}
                        </td>
                        <td className={`${cell} text-muted-foreground`}>
                          {d.graph
                            ? `${format.number(d.graph.nodes.length)} ${S.nodes}`
                            : B.calculations[d.calculation]}
                        </td>
                        <td className={`${cell} tabular-nums text-muted-foreground`}>
                          {format.number(d.revision)}
                        </td>
                        <td className={`${cell} text-end`}>
                          <RowMenu name={d.name}>
                            <DropdownMenuItem
                              onSelect={() => open({ kind: "assign", definition: d })}
                            >
                              {S.assign}
                            </DropdownMenuItem>
                            {d.source !== "manual" && (
                              <>
                                <DropdownMenuItem onSelect={() => setDesigner({ initial: d })}>
                                  {S.openDesigner}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => setDesigner({ initial: d, duplicate: true })}
                                >
                                  <Copy aria-hidden className="size-3.5" />
                                  {S.duplicate}
                                </DropdownMenuItem>
                              </>
                            )}
                          </RowMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ListEmpty>{definitions.length ? S.noMatches : S.emptyLibraryBody}</ListEmpty>
            ))}
        </TabsContent>
        <TabsContent value="scorecards" className="space-y-3 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {searchInput}
            <Button
              size="sm"
              disabled={!definitions.length}
              onClick={() => open({ kind: "scheme" })}
            >
              <Plus aria-hidden className="size-3.5" />
              {S.newScorecard}
            </Button>
          </div>
          {data &&
            (data.schemes.filter((s) => matches(s.name)).length ? (
              <div className="overflow-x-auto border-y">
                <table className="w-full text-start text-sm">
                  <caption className="sr-only">{S.scorecards}</caption>
                  <ListHead labels={[S.name, S.chooseKpis, S.revision, S.actions]} />
                  <tbody>
                    {data.schemes
                      .filter((s) => matches(s.name))
                      .map((s) => (
                        <tr key={s.id} className={rowClass}>
                          <td className={`${cell} min-w-52`}>
                            <Button
                              variant="ghost"
                              type="button"
                              className="h-auto min-h-8 justify-start p-0 text-start font-medium hover:bg-transparent hover:text-link"
                              onClick={() => open({ kind: "scheme", initial: s })}
                            >
                              {s.name}
                            </Button>
                          </td>
                          <td className={`${cell} text-muted-foreground`}>
                            {format.number(s.entries.length)}
                          </td>
                          <td className={`${cell} text-muted-foreground tabular-nums`}>
                            {format.number(s.revision)}
                          </td>
                          <td className={`${cell} text-end`}>
                            <RowMenu name={s.name}>
                              <DropdownMenuItem onSelect={() => open({ kind: "apply", scheme: s })}>
                                {S.apply}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => open({ kind: "scheme", initial: s })}
                              >
                                {S.revise}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  open({
                                    kind: "scheme",
                                    initial: { ...s, name: `${s.name} · ${S.duplicate}` },
                                    duplicate: true,
                                  })
                                }
                              >
                                {S.duplicate}
                              </DropdownMenuItem>
                            </RowMenu>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ListEmpty>{S.emptyScorecardsBody}</ListEmpty>
            ))}
        </TabsContent>
        <TabsContent value="templates" className="space-y-3 pt-3">
          {pack ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPack(null)}>
                  <ArrowLeft aria-hidden className="size-3.5" />
                  {S.back}
                </Button>
                <Button size="sm" onClick={() => open({ kind: "pack", pack })}>
                  {S.packCreate}
                </Button>
              </div>
              <h2 className="text-sm font-medium">{pack.name}</h2>
              <div className="overflow-x-auto border-y">
                <table className="w-full text-start text-sm">
                  <ListHead labels={[S.name, S.sourceDetails, S.actions]} />
                  <tbody>
                    {pack.templates.map((t) => (
                      <tr key={t.id} className={rowClass}>
                        <td className={`${cell} min-w-44 font-medium`}>{t.name}</td>
                        <td
                          className={`${cell} max-w-xl text-xs leading-relaxed text-muted-foreground`}
                        >
                          {t.requiredData}
                        </td>
                        <td className={cell}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => open({ kind: "assign", template: t })}
                          >
                            {S.useTemplate}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{S.packNote}</p>
              <div className="overflow-x-auto border-y">
                <table className="w-full text-start text-sm">
                  <ListHead labels={[S.name, S.descriptionLabel, S.sourceDetails]} />
                  <tbody>
                    {packs.map((p) => (
                      <tr key={p.id} className={rowClass}>
                        <td className={`${cell} min-w-48`}>
                          <Button
                            variant="ghost"
                            type="button"
                            onClick={() => setPack(p)}
                            className="h-auto min-h-8 justify-start p-0 text-start font-medium hover:bg-transparent hover:text-link"
                          >
                            {p.name}
                          </Button>
                        </td>
                        <td className={`${cell} text-xs text-muted-foreground`}>{p.description}</td>
                        <td className={`${cell} max-w-sm text-xs text-muted-foreground`}>
                          {p.requiredData}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
      {loading && (tab !== "goals" || props.goals.length > 0) && (
        <p role="status" className="text-xs text-muted-foreground">
          {S.loading}
        </p>
      )}
      {error !== null && (
        <div role="alert" className="flex items-center justify-between gap-3 border-t py-3">
          <p className="text-sm text-muted-foreground">
            {error === "E_KPI_NOT_READY" ? S.notReady : S.failed}
          </p>
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void reload()}>
            {S.retry}
          </Button>
        </div>
      )}
      <KpiGraphEditor
        open={designer !== null}
        onOpenChange={(value) => {
          if (!value) setDesigner(null);
        }}
        initialDefinition={designer?.initial}
        duplicate={designer?.duplicate}
        pipelines={props.pipelines}
        activityTypes={props.activityTypes}
        baseCurrency={props.baseCurrency}
        onSaved={() => {
          void reload();
        }}
      />
      <Dialog
        open={modal !== null}
        onOpenChange={(value) => {
          if (!value && !busy) close();
        }}
      >
        <DialogContent
          className={
            modal?.kind === "detail"
              ? "max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
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
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{workspaceModalDescription(modal, S)}</DialogDescription>
          </DialogHeader>
          {modal?.kind === "assign" && (
            <KpiBuilder
              users={props.users}
              teams={props.teams}
              pipelines={props.pipelines}
              activityTypes={props.activityTypes}
              baseCurrency={props.baseCurrency}
              initial={modal.template?.definition}
              initialCondition={
                modal.template?.condition ??
                data?.goals.find((r) => r.goal.definitionId === modal.definition?.id)?.goal
                  .condition
              }
              sourceRequirement={modal.template?.requiredData}
              definition={modal.definition}
              assignmentOnly
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
          {modal?.kind === "detail" && (
            <>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {presentation.condition(modal.row.goal.condition, modal.row.definition)}
                </span>
                <span className="font-semibold tabular-nums">
                  {presentation.value(modal.row.measurement.value, modal.row.definition)}
                </span>
              </div>
              <KpiEvidence row={modal.row} />
              {modal.row.definition.source === "manual" && (
                <Button onClick={() => open({ kind: "measurement", row: modal.row })}>
                  {S.recordMeasurement}
                </Button>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
