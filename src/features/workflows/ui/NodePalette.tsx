"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Tip } from "@/components/ui/tooltip";
import { useAppTranslations, useLocale } from "@/features/i18n/LocaleProvider";
import { useFormatters } from "@/lib/useFormatters";
import { maxDelayDays } from "../delayConfig";
import { displayNodeName } from "../nodeNames";
import type { PickerSelection } from "../paletteContext";
import { useConditionPortLabel } from "./conditionPortLabel";
import type { PaletteView, PaletteViewEntry } from "./paletteView";
import { WorkflowReferenceIcon } from "./WorkflowReferenceIcon";
import {
  NODE_ICONS,
  workflowNodeCategory,
  workflowNodeStrokeWidth,
} from "./workflowNodePresentation";
import styles from "./workflowPalette.module.css";
import "./workflowTheme.css";

const categoryOrder = [
  "nodeCategoryTrigger",
  "nodeCategoryData",
  "nodeCategoryFlow",
  "nodeCategoryCore",
] as const;

function PaletteRow({
  row,
  onChoose,
}: {
  row: PaletteViewEntry;
  onChoose: (selection: PickerSelection) => void;
}) {
  const t = useAppTranslations("workflows");
  const format = useFormatters();
  const descriptionId = useId();
  const structural = row.context.reason;
  const restriction =
    row.state.support === "unavailable"
      ? t("paletteUnavailable")
      : structural === "unavailable-action"
        ? t("paletteManualUnavailable")
        : structural !== null
          ? t(
              (row.catalog.type === "condition" || row.catalog.type === "ifElse") &&
                structural === "invalidPort"
                ? "paletteLinearOnly"
                : `connectionErrors.${structural}`,
            )
          : null;
  const actionDescription =
    row.catalog.type === "delay"
      ? t(row.catalog.descriptionKey, { days: format.number(maxDelayDays) })
      : t(row.catalog.descriptionKey);
  const warningKeys = {
    "activity-create-required": "paletteActivityRequired",
    "task-type-unavailable": "paletteTaskTypeUnavailable",
  } as const;
  const description = [
    restriction,
    actionDescription,
    t(row.state.provider === "not-required" ? "paletteNoProvider" : "paletteProviderNotAssessed"),
    ...row.state.executionReasons.map((reason) => t(warningKeys[reason])),
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <Tip label={description}>
      <button
        type="button"
        data-workflow-palette-choice
        className={styles.row}
        aria-disabled={!row.canChoose}
        aria-label={t(row.catalog.labelKey)}
        aria-describedby={descriptionId}
        onClick={() => {
          if (row.canChoose && row.selection !== null) onChoose(row.selection);
        }}
      >
        <span className={styles.icon} data-category={workflowNodeCategory(row.catalog.type)}>
          <WorkflowReferenceIcon
            name={NODE_ICONS[row.catalog.type]}
            size={16}
            stroke={workflowNodeStrokeWidth(row.catalog.type)}
          />
        </span>
        <span>{t(row.catalog.labelKey)}</span>
        {restriction !== null && (
          <span className={styles.restriction} aria-hidden="true">
            · {restriction}
          </span>
        )}
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
      </button>
    </Tip>
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
  const locale = useLocale();
  const labelPort = useConditionPortLabel();
  const source = model.definition.nodes.find((node) => node.id === model.context.source?.id);
  const rows = model.entries.filter(
    (row) => row.catalog.type.startsWith("trigger.") === model.triggerPicker,
  );
  const categories = categoryOrder.filter((category) =>
    rows.some((row) => workflowNodeCategory(row.catalog.type) === category),
  );
  return (
    <DialogPrimitive.Root
      open={open}
      modal={false}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogPrimitive.Content
        className={`workflow-twenty-theme ${styles.panel}`}
        onCloseAutoFocus={onCloseAutoFocus}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <header className={styles.header}>
          <DialogPrimitive.Title>
            {t(model.triggerPicker ? "selectTrigger" : "selectAction")}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close className={styles.close} aria-label={t("close")}>
            <WorkflowReferenceIcon name="x" size={16} />
          </DialogPrimitive.Close>
          <DialogPrimitive.Description className="sr-only">
            {t(model.replacing ? "replaceNodeHint" : "paletteHint")}
            {source !== undefined &&
              model.context.output !== null &&
              t("paletteContext", {
                name: displayNodeName(source, locale),
                port: labelPort(model.context.output.port, source),
              })}
          </DialogPrimitive.Description>
        </header>
        <div className={styles.body}>
          <PaletteReadNotice model={model} />
          {categories.map((category) => (
            <section key={category}>
              <h2 className={styles.category}>{t(category)}</h2>
              {rows
                .filter((row) => workflowNodeCategory(row.catalog.type) === category)
                .map((row) => (
                  <PaletteRow key={row.catalog.type} row={row} onChoose={onChoose} />
                ))}
            </section>
          ))}
          {model.status === "ready" && rows.length === 0 && <p role="status">{t("noNodes")}</p>}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Root>
  );
}
