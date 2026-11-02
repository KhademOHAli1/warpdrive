"use client";

import { useId } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/primitives/checkbox";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import {
  PROJECT_LIST_STATE_ORDER,
  type ProjectListRequest,
  projectListFilterKey,
} from "./persistence/projectListInput";
import { projectListTranslator } from "./projectListMessages";
import type { ProjectListViewProps } from "./projectListUiTypes";

const PRIVATE = `${BLOCK_CLASS} ph-no-capture`;

function sameRequest(left: ProjectListRequest, right: ProjectListRequest) {
  return (
    left.cursor === right.cursor &&
    left.pageSize === right.pageSize &&
    projectListFilterKey(left.filters) === projectListFilterKey(right.filters)
  );
}

export function ProjectListView(props: ProjectListViewProps) {
  const id = useId();
  const preferences = useLocalePreferences();
  const t = projectListTranslator(preferences.locale, preferences.numberingSystem);
  if (!props.canRead || props.contextKey.trim() === "" || props.requestId.trim() === "") {
    return (
      <p role="alert" className={PRIVATE}>
        {t("unavailable")}
      </p>
    );
  }
  const view =
    props.view !== null &&
    props.view.contextKey === props.contextKey &&
    props.view.requestId === props.requestId &&
    sameRequest(props.view.request, props.request)
      ? props.view
      : null;
  const loading = view === null || view.kind === "loading";
  const page = view?.kind === "ready" ? view.page : null;
  return (
    <section
      aria-labelledby={`${id}-heading`}
      aria-busy={loading}
      className={`${PRIVATE} space-y-4`}
      dir={directionForLocale(preferences.locale)}
    >
      <h2 id={`${id}-heading`} className="text-lg font-semibold">
        {t("heading")}
      </h2>
      <fieldset aria-describedby={`${id}-hint`} className="space-y-2">
        <legend className="text-sm font-medium">{t("states")}</legend>
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {t("stateHint")}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {PROJECT_LIST_STATE_ORDER.map((state) => {
            const checked = props.request.filters.states.includes(state);
            return (
              <div key={state} className="flex items-center gap-2">
                <Checkbox
                  id={`${id}-${state}`}
                  checked={checked}
                  disabled={checked && props.request.filters.states.length === 1}
                  onCheckedChange={(next) => {
                    const states = PROJECT_LIST_STATE_ORDER.filter((candidate) =>
                      candidate === state
                        ? next === true
                        : props.request.filters.states.includes(candidate),
                    );
                    if (states.length === 0) return;
                    props.onRequestChange({
                      ...props.request,
                      cursor: null,
                      filters: { ...props.request.filters, states },
                    });
                  }}
                />
                <label htmlFor={`${id}-${state}`} className="text-sm">
                  {t(state)}
                </label>
              </div>
            );
          })}
        </div>
      </fieldset>
      {loading && <p role="status">{t("loading")}</p>}
      {view?.kind === "error" && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {t("error")}
          </p>
          <Button type="button" onClick={() => props.onRetry(props.request)}>
            {t("retry")}
          </Button>
        </div>
      )}
      {page !== null && page.items.length === 0 && <p role="status">{t("empty")}</p>}
      {page !== null && page.items.length > 0 && (
        <ul aria-label={t("heading")} className="divide-y">
          {page.items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-4 py-2">
              <Button
                type="button"
                variant="ghost"
                className="h-auto min-w-0 shrink whitespace-normal text-start [overflow-wrap:anywhere]"
                onClick={() => props.onOpenProject(item.id)}
              >
                <bdi>{item.title}</bdi>
              </Button>
              <span className="shrink-0 text-sm text-muted-foreground">{t(item.state)}</span>
            </li>
          ))}
        </ul>
      )}
      {page !== null && page.nextCursor !== null && (
        <Button
          type="button"
          variant="outline"
          onClick={() => props.onRequestChange({ ...props.request, cursor: page.nextCursor })}
        >
          {t("next")}
        </Button>
      )}
    </section>
  );
}
