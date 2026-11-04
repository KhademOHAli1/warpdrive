"use client";

import { ArrowDown, Search } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { useAppTranslations, useLocale, useMessages } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { displayNodeName } from "../nodeNames";
import { orderedWorkflowNodes } from "../nodeOrder";
import type { PickerSelection } from "../paletteContext";
import { delayMinutesSchema } from "../registry";
import type { PaletteView, PaletteViewEntry } from "./paletteView";

function normalize(value: string) {
  return value.trim().toLocaleLowerCase().replaceAll("ي", "ی").replaceAll("ك", "ک");
}
function delayBounds(format: (number: number) => string) {
  const min = delayMinutesSchema.minValue;
  const max = delayMinutesSchema.maxValue;
  return { min: min === null ? "" : format(min), max: max === null ? "" : format(max) };
}
function PaletteSourceContext({ row, model }: { row: PaletteViewEntry; model: PaletteView }) {
  const t = useAppTranslations("workflows");
  const locale = useLocale();
  const fmt = useFormatters();
  const fields: Record<string, string> = useMessages().workflows.fields;
  const input = row.context.input;
  if (input.state === "not-required") return <span className="block">{t("paletteNoMapping")}</span>;
  if (input.state === "needs-mapping")
    return <span className="block">{t("paletteNeedsMapping")}</span>;
  const ordered = orderedWorkflowNodes(model.definition);
  return (
    <span className="block space-y-1">
      <span className="block">
        {t("paletteCompatible", { count: fmt.number(input.sources.length) })}
      </span>
      {input.sources.slice(0, 3).map((source) => {
        const node = model.definition.nodes.find((item) => item.id === source.nodeId);
        if (node === undefined) return null;
        const number = fmt.number(ordered.findIndex((item) => item.id === node.id) + 1);
        return (
          <bdi key={`${source.nodeId}:${source.path.join(".")}`} className="block break-words">
            {number} · {displayNodeName(node, locale)} ·{" "}
            {fields[source.path.join(".")] ?? t("unavailableValue")}
          </bdi>
        );
      })}
      {input.sources.length > 3 && (
        <span className="block">
          {t("paletteMoreSources", { count: fmt.number(input.sources.length - 3) })}
        </span>
      )}
    </span>
  );
}
function PaletteRow({
  row,
  model,
  onChoose,
}: {
  row: PaletteViewEntry;
  model: PaletteView;
  onChoose: (selection: PickerSelection) => void;
}) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  const structural = row.context.reason;
  const linear = row.catalog.type === "condition" && model.context.occupiedDestinationId !== null;
  const warningKeys = {
    "activity-create-required": "paletteActivityRequired",
    "task-type-unavailable": "paletteTaskTypeUnavailable",
  } as const;
  return (
    <Button
      type="button"
      variant="outline"
      aria-disabled={!row.canChoose}
      className="h-auto w-full justify-start whitespace-normal p-4 text-start aria-disabled:opacity-70"
      onClick={() => {
        if (row.canChoose && row.selection !== null) onChoose(row.selection);
      }}
    >
      <span className="block min-w-0 space-y-2">
        <span className="block font-semibold">{t(row.catalog.labelKey)}</span>
        <span className="block text-xs font-normal leading-5 text-muted-foreground">
          {row.catalog.type === "delay"
            ? t(row.catalog.descriptionKey, delayBounds(fmt.number))
            : t(row.catalog.descriptionKey)}
        </span>
        {row.state.support === "unavailable" && (
          <span className="block text-xs">{t("paletteUnavailable")}</span>
        )}
        {structural === "unavailable-action" && row.state.support === "supported" && (
          <span className="block text-xs">{t("paletteManualUnavailable")}</span>
        )}
        <span className="block text-xs">
          {t(
            row.state.provider === "not-required"
              ? "paletteNoProvider"
              : "paletteProviderNotAssessed",
          )}
        </span>
        {row.state.executionReasons.map((reason) => (
          <span className="block text-xs" key={reason}>
            {t(warningKeys[reason])}
          </span>
        ))}
        {structural !== null && structural !== "unavailable-action" && (
          <span className="block text-xs">
            {linear ? t("paletteLinearOnly") : t(`connectionErrors.${structural}`)}
          </span>
        )}
        <span className="block text-xs font-normal text-muted-foreground">
          <PaletteSourceContext row={row} model={model} />
        </span>
        {(row.catalog.type === "record.read" || row.catalog.type === "activity.create") && (
          <span className="block text-xs font-normal text-muted-foreground">
            {t("paletteRecordAccess")}
          </span>
        )}
      </span>
    </Button>
  );
}
function PaletteReadNotice({ model }: { model: PaletteView }) {
  const t = useAppTranslations("workflows");
  const guard = useRef(false);
  const [pending, setPending] = useState(false);
  async function retry() {
    if (guard.current || model.retrying) return;
    guard.current = true;
    setPending(true);
    try {
      await model.retry();
    } catch {
      /* The read-state owner supplies the safe failure UI. */
    } finally {
      guard.current = false;
      setPending(false);
    }
  }
  if (model.status === "loading") return <p role="status">{t("paletteLoading")}</p>;
  if (model.status === "denied") return <p role="alert">{t("paletteDenied")}</p>;
  if (model.status === "error")
    return (
      <div role="alert" className="space-y-3">
        <p>{t("paletteReadError")}</p>
        <Button
          type="button"
          variant="outline"
          disabled={pending || model.retrying}
          onClick={() => void retry()}
        >
          {t("retry")}
        </Button>
      </div>
    );
  const reasons = {
    "workflow-edit-required": "paletteEditRequired",
    "workflow-archived": "paletteArchived",
    "editor-readonly": "paletteReadOnly",
  } as const;
  return model.authoringReason === null ? null : (
    <p role="status">{t(reasons[model.authoringReason])}</p>
  );
}

export function NodePalette({
  open,
  onClose,
  onCloseAutoFocus,
  model,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  model: PaletteView;
  onChoose: (selection: PickerSelection) => void;
}) {
  const t = useAppTranslations("workflows");
  const [search, setSearch] = useState("");
  const query = normalize(search);
  const fmt = useFormatters();
  const matches = model.entries.filter((row) =>
    normalize(
      `${t(row.catalog.categoryKey)} ${t(row.catalog.labelKey)} ${row.catalog.type === "delay" ? t(row.catalog.descriptionKey, delayBounds(fmt.number)) : t(row.catalog.descriptionKey)}`,
    ).includes(query),
  );
  const groups = [...new Set(matches.map((row) => row.catalog.category))];
  const source =
    model.context.source === null
      ? undefined
      : model.definition.nodes.find((node) => node.id === model.context.source?.id);
  const locale = useLocale();
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-2xl overflow-y-auto"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t("chooseNode")}</DialogTitle>
          <DialogDescription>{t("paletteHint")}</DialogDescription>
        </DialogHeader>
        {model.context.output !== null && (
          <p className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
            <ArrowDown className="size-3.5 shrink-0" />
            <bdi>
              {t("paletteContext", {
                name:
                  source === undefined ? t("unavailableValue") : displayNodeName(source, locale),
                port: t(
                  model.context.output.port === "true"
                    ? "truePort"
                    : model.context.output.port === "false"
                      ? "falsePort"
                      : "nextPort",
                ),
              })}
            </bdi>
          </p>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            aria-label={t("searchNodes")}
            placeholder={t("searchNodes")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="ps-9"
          />
        </div>
        <PaletteReadNotice model={model} />
        {groups.map((category) => {
          const rows = matches.filter((row) => row.catalog.category === category);
          const first = rows[0];
          return first === undefined ? null : (
            <section className="space-y-2" key={category}>
              <h2 className="text-sm font-semibold">{t(first.catalog.categoryKey)}</h2>
              {rows.map((row) => (
                <PaletteRow key={row.catalog.type} row={row} model={model} onChoose={onChoose} />
              ))}
            </section>
          );
        })}
        {model.status === "ready" && matches.length === 0 && (
          <div role="status" className="space-y-3 rounded-lg border border-dashed p-6 text-center">
            <p>{t("noNodes")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setSearch("")}>
              {t("clearSearch")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
