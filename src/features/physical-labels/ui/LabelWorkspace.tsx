"use client";

import { Plus, Printer, ScanLine } from "lucide-react";
import Link from "next/link";
import { type RefObject, useId, useRef, useState } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { EditorSelect } from "@/features/assets/ui/AssetEditorFields";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { CatalogField } from "@/features/inventory/catalog/ui/CatalogFields";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  type LabelCommand,
  type LabelError,
  type LabelRecord,
  type LabelResult,
  type LabelsWorkspace,
  labelCommand,
  labelTargetKinds,
} from "../contracts";
import { encodeLabel, labelPrintItem } from "../encodeLabel";
import {
  displayLabelCode,
  formatNames,
  type LabelEditor,
  LabelEditorDialog,
  type LabelIntent,
} from "./LabelEditorDialog";
import { LabelPrintDialog, type LabelPrintItem } from "./LabelPrintDialog";
import { type LabelWords, labelMessages } from "./labelMessages";

type Filters = { query: string; kind: string; status: string };
const clearFilters: Filters = { query: "", kind: "", status: "" };
const statusFor = (label: LabelRecord) => (label.retiredAt === null ? "active" : "retired");
const cell = "px-3 py-2.5 text-start align-middle";
const heading = `${cell} text-xs font-medium text-muted-foreground`;

function RegistryFilters({
  filters,
  search,
  onFilters,
  words: t,
}: {
  filters: Filters;
  search: RefObject<HTMLInputElement | null>;
  onFilters: (filters: Filters) => void;
  words: LabelWords;
}) {
  const searchId = useId();
  return (
    <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <CatalogField label={t.search} id={searchId}>
        <Input
          id={searchId}
          ref={search}
          type="search"
          className="h-9"
          value={filters.query}
          onChange={(event) => onFilters({ ...filters, query: event.target.value })}
        />
      </CatalogField>
      <EditorSelect
        label={t.targetType}
        value={filters.kind}
        options={[
          { value: "", label: t.allTargets },
          ...labelTargetKinds.map((kind) => ({ value: kind, label: t[kind] })),
        ]}
        onChange={(kind) => onFilters({ ...filters, kind })}
      />
      <EditorSelect
        label={t.status}
        value={filters.status}
        options={[
          { value: "", label: t.allStatuses },
          { value: "active", label: t.active },
          { value: "retired", label: t.retired },
        ]}
        onChange={(status) => onFilters({ ...filters, status })}
      />
    </div>
  );
}

function RegistryTable({
  rows,
  selected,
  pending,
  onSelect,
  onRetire,
  words: t,
}: {
  rows: LabelRecord[];
  selected: Set<string>;
  pending: boolean;
  onSelect: (ids: string[], checked: boolean) => void;
  onRetire: (button: HTMLElement, label: LabelRecord) => void;
  words: LabelWords;
}) {
  const printable = rows.filter(({ retiredAt }) => retiredAt === null).map(({ id }) => id);
  const selectedCount = printable.filter((id) => selected.has(id)).length;
  const allChecked = selectedCount === printable.length;
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border bg-card">
      <table aria-label={t.labels} className="w-full min-w-[40rem] border-collapse text-sm">
        <thead className="border-b bg-muted/35">
          <tr>
            <th scope="col" className={`${heading} w-10`}>
              <Checkbox
                label={t.selectAll}
                disabled={printable.length === 0}
                checked={selectedCount === 0 ? false : allChecked || "indeterminate"}
                onCheckedChange={(checked) => onSelect(printable, checked)}
              />
            </th>
            <th scope="col" className={heading}>
              {t.code}
            </th>
            <th scope="col" className={heading}>
              {t.target}
            </th>
            <th scope="col" className={heading}>
              {t.format}
            </th>
            <th scope="col" className={heading}>
              {t.status}
            </th>
            <th scope="col" className={heading}>
              <span className="sr-only">{t.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((label) => {
            const active = label.retiredAt === null;
            const value = displayLabelCode(label.value);
            const { target } = label;
            return (
              <tr
                key={label.id}
                data-physical-label={label.id}
                className={selected.has(label.id) ? "bg-muted/45" : undefined}
              >
                <td className={cell}>
                  {active && (
                    <Checkbox
                      label={t.selectLabel.replace("{code}", () => value)}
                      checked={selected.has(label.id)}
                      onCheckedChange={(checked) => onSelect([label.id], checked)}
                    />
                  )}
                </td>
                <th scope="row" className={`${cell} font-medium`}>
                  <bdi
                    className="block max-w-56 font-mono text-xs [overflow-wrap:anywhere]"
                    dir="ltr"
                  >
                    {value}
                  </bdi>
                </th>
                <td className={cell}>
                  {target.href === null ? (
                    <bdi className="font-medium">{target.title}</bdi>
                  ) : (
                    <Link
                      href={target.href}
                      className="rounded-sm font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <bdi>{target.title}</bdi>
                    </Link>
                  )}
                  <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {t[target.kind]}
                    {target.subtitle !== null && (
                      <>
                        {" "}
                        · <bdi>{target.subtitle}</bdi>
                      </>
                    )}
                  </span>
                </td>
                <td className={cell}>
                  <bdi>{formatNames[label.format]}</bdi>
                  <span className="block text-xs text-muted-foreground">{t[label.source]}</span>
                </td>
                <td className={cell}>
                  <Badge variant="outline">{t[statusFor(label)]}</Badge>
                </td>
                <td className={`${cell} text-end`}>
                  {active && target.canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={(event) => onRetire(event.currentTarget, label)}
                    >
                      {t.retire}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function LabelWorkspace({
  initial,
  submit,
  fixture,
  resetFixture,
}: {
  initial: LabelsWorkspace;
  submit: (command: LabelCommand) => Promise<LabelResult>;
  fixture: boolean;
  resetFixture?: () => void;
}) {
  const locale = useLocale();
  const t = labelMessages[locale];
  const [source, setSource] = useState(initial);
  const [workspace, setWorkspace] = useState(initial);
  const [filters, setFilters] = useState(clearFilters);
  const [selected, setSelected] = useState(() => new Set<string>());
  const [editor, setEditor] = useState<LabelEditor | null>(null);
  const [printItems, setPrintItems] = useState<LabelPrintItem[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LabelError | "transport" | null>(null);
  const [notice, setNotice] = useState<"saved" | "retiredNotice" | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const lastTrigger = useRef<HTMLElement | null>(null);
  const active = useRef(false);
  const request = useRef<{ intent: string; id: string } | null>(null);

  if (source !== initial) {
    setSource(initial);
    if (JSON.stringify(source) !== JSON.stringify(initial)) setWorkspace(initial);
  }

  const canManage = workspace.targets.some(({ canManage }) => canManage);
  const query = filters.query.trim().toLocaleLowerCase(locale);
  const rows = workspace.labels.filter((label) => {
    if (filters.kind !== "" && filters.kind !== label.target.kind) return false;
    if (filters.status !== "" && filters.status !== statusFor(label)) return false;
    return [label.value, label.target.title, label.target.subtitle, formatNames[label.format]].some(
      (value) => (value ?? "").toLocaleLowerCase(locale).includes(query),
    );
  });
  const printable = rows.filter(({ id, retiredAt }) => retiredAt === null && selected.has(id));

  function applyFilters(next: Filters) {
    setFilters(next);
    setSelected(new Set());
  }

  function select(ids: string[], checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function open(trigger: HTMLElement, next: LabelEditor) {
    lastTrigger.current = trigger;
    setNotice(null);
    setError(null);
    setEditor(next);
  }

  function restoreFocus() {
    const trigger = lastTrigger.current;
    (trigger?.isConnected === true ? trigger : search.current)?.focus();
  }

  async function save(intent: LabelIntent) {
    if (active.current) return;
    const key = JSON.stringify(intent);
    const prior = request.current;
    const id = prior?.intent === key ? prior.id : crypto.randomUUID();
    const command = labelCommand.safeParse({ ...intent, requestId: id });
    if (!command.success) {
      setError("invalid");
      return;
    }
    active.current = true;
    request.current = { intent: key, id };
    setPending(true);
    setError(null);
    try {
      const result = await submit(command.data);
      request.current = null;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setWorkspace(result.value);
      setFilters(clearFilters);
      setSelected(intent.type === "retire" ? new Set() : new Set([result.focusId]));
      setNotice(intent.type === "retire" ? "retiredNotice" : "saved");
      setEditor(null);
    } catch {
      setError("transport");
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  return (
    <section className={`${BLOCK_CLASS} ph-no-capture min-w-0`} aria-busy={pending}>
      <PageHeading
        title={t.labels}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {fixture && <Badge variant="outline">{t.demo}</Badge>}
            {/* The camera permission belongs to the document opened at the scanner URL. */}
            <a className={buttonVariants({ variant: "outline" })} href="/operations/scan">
              <ScanLine size={16} aria-hidden="true" /> {t.scan}
            </a>
            {canManage && (
              <>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={(event) => open(event.currentTarget, { type: "registerExternal" })}
                >
                  {t.register}
                </Button>
                <Button
                  disabled={pending}
                  onClick={(event) => open(event.currentTarget, { type: "issue" })}
                >
                  <Plus size={16} aria-hidden="true" /> {t.issue}
                </Button>
              </>
            )}
          </div>
        }
      />
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-card p-3">
          <div className="min-w-0 flex-1 basis-[27rem]">
            <RegistryFilters {...{ filters, search }} onFilters={applyFilters} words={t} />
          </div>
          <div className="flex flex-wrap gap-2">
            {fixture && resetFixture !== undefined && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={resetFixture}>
                {t.reset}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={printable.length === 0 || pending}
              onClick={(event) => {
                lastTrigger.current = event.currentTarget;
                setPrintItems(
                  printable.map((label) => labelPrintItem(label, window.location.origin)),
                );
              }}
            >
              <Printer aria-hidden="true" size={16} />{" "}
              {t.print.replace("{count}", String(printable.length))}
            </Button>
          </div>
        </div>
        {notice !== null && (
          <p role="status" className="text-sm text-muted-foreground">
            {t[notice]}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">
            {workspace.labels.length === 0 ? t.noLabels : t.noMatches}
          </p>
        ) : (
          <RegistryTable
            {...{ rows, selected, pending }}
            onSelect={select}
            onRetire={(trigger, label) => open(trigger, { type: "retire", label })}
            words={t}
          />
        )}
      </div>
      {editor !== null && (
        <LabelEditorDialog
          editor={editor}
          targets={workspace.targets}
          words={t}
          state={{
            pending,
            error: error === null ? null : t[error],
            close: () => setEditor(null),
            restoreFocus,
            submit: (intent) => void save(intent),
          }}
        />
      )}
      {printItems !== null && (
        <LabelPrintDialog
          items={printItems}
          encode={encodeLabel}
          close={() => setPrintItems(null)}
          restoreFocus={restoreFocus}
        />
      )}
    </section>
  );
}
