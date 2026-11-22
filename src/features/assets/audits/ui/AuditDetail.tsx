"use client";

import { Camera, FilePenLine, RotateCcw } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PILL_TAB, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SalesInput } from "@/features/inventory/sales/ui/SalesFields";
import { EditorSelect } from "../../ui/AssetEditorFields";
import type { EquipmentAuditDetail, EquipmentAuditRow } from "../contracts";
import {
  AuditActivity,
  AuditDocuments,
  AuditEvidence,
  AuditProgress,
  AuditTime,
} from "./AuditDocuments";
import {
  type AuditEditor,
  equipmentLabel,
  type OpenAuditEditor,
  placementLabel,
} from "./auditView";
import type { AuditWords } from "./messages";

export type ScanResponse =
  | "scanPending"
  | "scanDuplicate"
  | "scanChoose"
  | "invalid"
  | "unavailable"
  | "transport";
type AuditScannerAction = (value: string, trigger: HTMLElement) => Promise<ScanResponse>;

function AuditScanner({
  scan,
  disabled,
  words: t,
}: {
  scan: AuditScannerAction;
  disabled: boolean;
  words: AuditWords;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const active = useRef(false);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<ScanResponse | null>(null);
  async function lookup() {
    const trigger = input.current;
    const code = value.trim();
    if (active.current || disabled || code === "" || trigger === null) return;
    active.current = true;
    setPending(true);
    setFeedback(null);
    let next: ScanResponse;
    try {
      next = await scan(code, trigger);
    } catch {
      next = "transport";
    } finally {
      active.current = false;
      setPending(false);
      setValue("");
    }
    setFeedback(next);
    if (next !== "scanPending" && next !== "scanChoose") input.current?.focus();
  }
  return (
    <form
      className="space-y-1 rounded-md border bg-background p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void lookup();
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <SalesInput
            label={t.scan}
            ref={input}
            data-audit-scan
            value={value}
            disabled={disabled}
            readOnly={pending}
            maxLength={4096}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          type="submit"
          disabled={disabled || pending || value.trim() === ""}
        >
          {t.addScan}
        </Button>
      </div>
      <p
        role="status"
        data-audit-scan-result={feedback ?? undefined}
        className="text-xs text-muted-foreground"
      >
        {pending ? t.scanning : feedback === null ? null : t[feedback]}
      </p>
    </form>
  );
}

type AuditAction = { editor: AuditEditor; label: string; primary?: boolean };

function manageActions(detail: EquipmentAuditDetail, words: AuditWords): AuditAction[] {
  const { canCount, canManage, archived, status, reviewedAt } = detail;
  const actions: AuditAction[] = [];
  if (archived)
    return canManage ? [{ editor: { type: "archive" }, label: words.restore }] : actions;
  if (status === "draft" && canCount)
    actions.push({ editor: { type: "start" }, label: words.start, primary: true });
  if (status === "active" && canCount)
    actions.push({ editor: { type: "complete" }, label: words.complete, primary: true });
  if (!canManage) return actions;
  if (status === "draft" || status === "active") {
    if (status === "draft") actions.push({ editor: { type: "edit" }, label: words.edit });
    actions.push(
      { editor: { type: "assign" }, label: words.assign },
      { editor: { type: "cancel" }, label: words.cancelAudit },
    );
  } else {
    if (status === "completed" && reviewedAt === null)
      actions.push({ editor: { type: "review" }, label: words.review });
    actions.push({ editor: { type: "archive" }, label: words.archive });
    actions.push({ editor: { type: "duplicate" }, label: words.duplicate });
  }
  return actions;
}

function AuditActions({
  detail,
  pending,
  open,
  words: t,
}: {
  detail: EquipmentAuditDetail;
  pending: boolean;
  open: OpenAuditEditor;
  words: AuditWords;
}) {
  const actions = manageActions(detail, t);
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(({ editor, label, primary }) => (
        <Button
          key={editor.type}
          variant={primary === true ? "default" : "outline"}
          size="sm"
          disabled={pending}
          data-audit-action={editor.type}
          onClick={(event) => open(event.currentTarget, editor)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

function RowActions({
  row,
  pending,
  open,
  words: t,
}: {
  row: EquipmentAuditRow;
  pending: boolean;
  open: OpenAuditEditor;
  words: AuditWords;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(row.expected !== null || row.counted !== null) && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          data-audit-row-count
          onClick={(event) => open(event.currentTarget, { type: "setCount", rows: [row] })}
        >
          {t.setCount}
        </Button>
      )}
      {row.canUndo && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          data-audit-row-undo
          onClick={(event) => open(event.currentTarget, { type: "undo", row })}
        >
          <RotateCcw className="size-3.5" aria-hidden="true" /> {t.undo}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        data-audit-row-note
        onClick={(event) => open(event.currentTarget, { type: "note", row })}
      >
        <FilePenLine className="size-3.5" aria-hidden="true" /> {t.addNote}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        data-audit-row-photo
        onClick={(event) => open(event.currentTarget, { type: "attach", row })}
      >
        <Camera className="size-3.5" aria-hidden="true" /> {t.attach}
      </Button>
    </div>
  );
}

const resultStatuses = ["not_scanned", "found", "partial", "missing", "unexpected"] as const;
function Findings({
  detail,
  canCount,
  pending,
  open,
  scan,
  words: t,
}: {
  detail: EquipmentAuditDetail;
  canCount: boolean;
  pending: boolean;
  open: OpenAuditEditor;
  scan: AuditScannerAction;
  words: AuditWords;
}) {
  const id = useId();
  const [filter, setFilter] = useState("");
  const visible = detail.rows.filter((row) => filter === "" || filter === row.result);
  const options = resultStatuses.filter((status) =>
    status === "missing"
      ? detail.status === "completed"
      : status !== "not_scanned" || detail.status !== "completed",
  );
  return (
    <div className="space-y-3">
      {canCount && <AuditScanner scan={scan} disabled={pending} words={t} />}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-36">
          <EditorSelect
            label={t.findings}
            options={[
              { value: "", label: t.allResults },
              ...options.map((value) => ({ value, label: t[value] })),
            ]}
            value={filter}
            onChange={setFilter}
          />
        </div>
        {canCount && detail.rows.some(({ expected }) => expected !== null) && (
          <Button
            size="sm"
            variant="outline"
            data-audit-action="bulkCount"
            disabled={pending}
            onClick={(event) => open(event.currentTarget, { type: "bulkCount" })}
          >
            {t.bulkCount}
          </Button>
        )}
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.noFindings}</p>
      ) : (
        <ul className="divide-y rounded-md border" aria-labelledby={id}>
          {visible.map((row) => (
            <li key={row.id} data-audit-line={row.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 wrap-anywhere">
                  <p className="font-medium">
                    <bdi>{equipmentLabel(row, t)}</bdi>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <bdi>{placementLabel(row, t)}</bdi>
                  </p>
                </div>
                <Badge
                  variant={row.result === "missing" ? "destructive" : "outline"}
                  data-audit-result={row.result}
                >
                  {t[row.result]}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {row.expected !== null && (
                  <span>
                    {t.expectedUnits} <bdi data-audit-expected={row.expected}>{row.expected}</bdi>
                  </span>
                )}
                <span>
                  {t.countedUnits}{" "}
                  <bdi data-audit-counted={row.counted ?? undefined}>{row.counted ?? "—"}</bdi>
                </span>
              </div>
              {canCount && <RowActions {...{ row, open, pending }} words={t} />}
            </li>
          ))}
        </ul>
      )}
      <p id={id} className="sr-only">
        {t.findings}
      </p>
    </div>
  );
}

function ScopePreview({ detail, words: t }: { detail: EquipmentAuditDetail; words: AuditWords }) {
  const entries = [
    { label: t.locations, value: detail.scope.locationIds.length },
    { label: t.equipment, value: detail.scope.assetIds.length },
    { label: t.kits, value: detail.scope.kitIds.length },
    { label: t.categories, value: detail.scope.categoryIds.length },
  ].filter(({ value }) => value > 0);
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <span className="font-medium">{t.scope}</span>
      {entries.map(({ label, value }) => (
        <Badge key={label} variant="outline">
          {label} {value}
        </Badge>
      ))}
      {detail.scope.tag !== null && (
        <Badge variant="outline">
          <bdi>{detail.scope.tag}</bdi>
        </Badge>
      )}
      {entries.length === 0 && detail.scope.tag === null && (
        <span className="text-muted-foreground">{t.wholeSite}</span>
      )}
      {detail.scope.includeCustody && <Badge variant="outline">{t.custody}</Badge>}
    </div>
  );
}

export function AuditStatus({
  status,
  archived,
  words: t,
}: {
  status: EquipmentAuditDetail["status"];
  archived: boolean;
  words: AuditWords;
}) {
  const display = archived ? "archived" : status;
  return (
    <Badge variant="outline" data-audit-status={display}>
      {t[display]}
    </Badge>
  );
}

export function AuditDetail({
  detail,
  pending,
  open,
  scan,
  titleRef,
  words: t,
}: {
  detail: EquipmentAuditDetail;
  pending: boolean;
  open: OpenAuditEditor;
  scan: AuditScannerAction;
  titleRef?: (title: HTMLHeadingElement | null) => void;
  words: AuditWords;
}) {
  const canCount = detail.canCount && !detail.archived && detail.status === "active";
  return (
    <article
      data-audit-detail={detail.id}
      className="min-w-0 divide-y rounded-lg border bg-card"
      aria-busy={pending}
    >
      <header className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2
              ref={titleRef}
              tabIndex={titleRef === undefined ? undefined : -1}
              className="text-lg font-semibold wrap-anywhere"
            >
              <bdi>{detail.title}</bdi>
            </h2>
            <p className="text-sm text-muted-foreground">
              <bdi>{detail.siteName}</bdi>
            </p>
          </div>
          <AuditStatus status={detail.status} archived={detail.archived} words={t} />
        </div>
        <div className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-2">
          {detail.dueAt !== null && (
            <span>
              {t.due} <AuditTime value={detail.dueAt} />
            </span>
          )}
          {detail.startedAt !== null && (
            <span>
              {t.started} <AuditTime value={detail.startedAt} />
            </span>
          )}
          {detail.completedAt !== null && (
            <span>
              {t.completed} <AuditTime value={detail.completedAt} />
            </span>
          )}
          {detail.reviewedAt !== null && (
            <span>
              {t.reviewed} <AuditTime value={detail.reviewedAt} />
            </span>
          )}
          <p className="wrap-anywhere text-muted-foreground">
            {detail.assignees.length === 0 ? (
              t.noAssignees
            ) : (
              <>
                {t.assignees} <bdi>{detail.assignees.map(({ name }) => name).join(", ")}</bdi>
              </>
            )}
          </p>
        </div>
        <ScopePreview detail={detail} words={t} />
        <AuditActions {...{ detail, pending, open }} words={t} />
        {detail.status !== "draft" && (
          <AuditProgress
            progress={detail.progress}
            completed={detail.status === "completed"}
            words={t}
          />
        )}
      </header>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {canCount && (
            <>
              <Button
                size="sm"
                variant="outline"
                data-audit-action="note"
                disabled={pending}
                onClick={(event) => open(event.currentTarget, { type: "note", row: null })}
              >
                {t.addNote}
              </Button>
              <Button
                size="sm"
                variant="outline"
                data-audit-action="attach"
                disabled={pending}
                onClick={(event) => open(event.currentTarget, { type: "attach", row: null })}
              >
                {t.attach}
              </Button>
            </>
          )}
          <AuditDocuments detail={detail} words={t} />
        </div>
        <Tabs defaultValue="findings">
          <TabsList
            aria-label={t.findings}
            className="inline-flex flex-wrap gap-1 rounded-lg border bg-background p-0.5"
          >
            <TabsTrigger className={PILL_TAB} value="findings">
              {t.findings}
            </TabsTrigger>
            <TabsTrigger className={PILL_TAB} value="activity">
              {t.activity}
            </TabsTrigger>
            <TabsTrigger className={PILL_TAB} value="evidence">
              {t.evidence}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="findings" className="pt-3">
            <Findings
              key={detail.status}
              {...{ detail, canCount, pending, open, scan }}
              words={t}
            />
          </TabsContent>
          <TabsContent value="activity" className="pt-3">
            <AuditActivity activity={detail.activity} words={t} />
          </TabsContent>
          <TabsContent value="evidence" className="pt-3">
            <AuditEvidence detail={detail} words={t} />
          </TabsContent>
        </Tabs>
      </div>
    </article>
  );
}
