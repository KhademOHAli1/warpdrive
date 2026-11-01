"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { useAppTranslations, useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { directionForLocale } from "@/features/i18n/registry";
import type { NextActionQueueProps } from "./NextActionQueue.types";
import { useNextActionQueueCompletion } from "./NextActionQueueCompletion";
import { NextActionQueueContent } from "./NextActionQueueContent";

export type { NextActionQueueProps, QueueCompletionResult } from "./NextActionQueue.types";

export function NextActionQueue(props: NextActionQueueProps): ReactNode {
  const t = useAppTranslations("nextActionQueue");
  const preferences = useLocalePreferences();
  const page =
    !props.loading &&
    !props.error &&
    props.page?.scope === props.input.scope &&
    props.page.limit === props.input.limit &&
    props.page.offset === props.input.offset
      ? props.page
      : null;
  const completion = useNextActionQueueCompletion({
    readId: page?.readId ?? null,
    complete: props.onCompleteActivity,
    refresh: props.onRefresh,
  });
  const unavailable = props.error || page === null || completion.held !== undefined;
  return (
    <section
      aria-label={t("title")}
      dir={directionForLocale(preferences.locale)}
      className="space-y-4"
    >
      <header className="space-y-2">
        <h1 className="text-display font-[450]">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Select
            value={props.input.scope}
            onChange={(scope) =>
              props.onScopeChange(scope === "all-permitted" ? "all-permitted" : "mine")
            }
            ariaLabel={t("scopeLabel")}
            options={[
              { value: "mine", label: t("mine") },
              { value: "all-permitted", label: t("allPermitted") },
            ]}
            triggerClassName="min-w-48"
          />
          <p className="text-xs text-muted-foreground">{t("orderHint")}</p>
        </div>
      </header>
      {unavailable ? (
        <div className="space-y-2 rounded-md border bg-card p-4">
          {props.error || completion.held === "denied" ? (
            <p role="alert" className="text-sm text-destructive">
              {completion.held === "denied" ? t("actionDenied") : t("loadError")}
            </p>
          ) : (
            <p role="status" className="text-sm">
              {completion.held === "saved" ? t("saved") : t("updating")}
            </p>
          )}
          {(props.error || completion.held !== undefined) && (
            <Button size="sm" variant="outline" disabled={props.loading} onClick={props.onRefresh}>
              {t("refresh")}
            </Button>
          )}
        </div>
      ) : (
        page !== null && (
          <NextActionQueueContent page={page} callbacks={props} completion={completion} />
        )
      )}
    </section>
  );
}
