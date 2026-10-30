"use client";
import { Building2, Search, Users, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

export function ContactDirectoryToolbar({
  kind,
  draft,
  onSearch,
  onSubmit,
  onClear,
  children,
  summary,
}: {
  kind: "person" | "org";
  draft: string;
  onSearch: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  children: ReactNode;
  summary: ReactNode;
}) {
  const t = useAppTranslations("contacts");
  const label = t(kind === "person" ? "directory.searchPeople" : "directory.searchOrgs");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
      <search aria-label={label} className="relative min-w-0 basis-64 flex-1 sm:max-w-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            maxLength={200}
            aria-label={label}
            placeholder={label}
            value={draft}
            className="h-10 bg-muted/30 ps-9 pe-9 [&::-webkit-search-cancel-button]:hidden"
            onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClear();
              }
            }}
          />
          {draft !== "" && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("directory.clearSearch")}
              className="absolute end-1 top-1/2 size-8 -translate-y-1/2"
              onClick={onClear}
            >
              <X aria-hidden="true" className="size-3.5" />
            </Button>
          )}
        </form>
      </search>
      <p role="status" className="text-xs text-muted-foreground tabular-nums">
        {summary}
      </p>
      <div className="ms-auto flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function ContactDirectoryEmptyState({
  kind,
  narrowed,
  onClear,
  action,
}: {
  kind: "person" | "org";
  narrowed: boolean;
  onClear: () => void;
  action?: ReactNode;
}) {
  const t = useAppTranslations("contacts");
  const Icon = kind === "person" ? Users : Building2;
  return (
    <div className="flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon aria-hidden="true" className="size-6" />
      </div>
      <h2 className="text-base font-semibold">
        {t(
          narrowed
            ? "directory.noMatches"
            : kind === "person"
              ? "directory.emptyPeople"
              : "directory.emptyOrgs",
        )}
      </h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
        {t(
          narrowed
            ? "directory.noMatchesHelp"
            : kind === "person"
              ? "directory.emptyPeopleHelp"
              : "directory.emptyOrgsHelp",
        )}
      </p>
      <div className="mt-5">
        {narrowed ? (
          <Button type="button" variant="outline" onClick={onClear}>
            {t("directory.clearAll")}
          </Button>
        ) : (
          action
        )}
      </div>
    </div>
  );
}

export function ContactDirectoryCriteria({
  query,
  count,
  onClear,
}: {
  query: string;
  count: number;
  onClear: () => void;
}) {
  const t = useAppTranslations("contacts");
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
      {query !== "" && (
        <span className="rounded-md border bg-background px-2 py-1">
          <bdi dir="auto">{query}</bdi>
        </span>
      )}
      {count > 0 && <span>{t("directory.filterCount", { count })}</span>}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ms-auto h-7 text-xs"
        onClick={onClear}
      >
        {t("directory.clearAll")}
      </Button>
    </div>
  );
}
