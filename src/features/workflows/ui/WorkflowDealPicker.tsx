import { useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";

export type WorkflowDealOption = { value: string; label: string };

export function WorkflowDealPicker({
  chosen,
  onChoose,
  disabled,
  feedback = "inherit",
}: {
  chosen: WorkflowDealOption | null;
  onChoose: (option: WorkflowDealOption | null) => void;
  disabled: boolean;
  feedback?: "inherit" | "muted";
}) {
  const t = useAppTranslations("workflows");
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const search = trpc.search.query.useQuery(
    { q: trimmed.slice(0, 200) },
    { enabled: !disabled && trimmed.length > 1 },
  );
  const options = (search.data?.deals ?? []).map((deal) => ({
    value: deal.id,
    label: deal.primary,
  }));
  if (chosen !== null && !options.some((option) => option.value === chosen.value))
    options.unshift(chosen);
  const statusClass = feedback === "muted" ? "text-sm text-muted-foreground" : undefined;

  return (
    <>
      <Input
        dir="auto"
        aria-label={t("search")}
        placeholder={t("search")}
        maxLength={200}
        value={query}
        disabled={disabled}
        onChange={(event) => setQuery(event.target.value)}
      />
      <Select
        value={chosen?.value ?? ""}
        ariaLabel={t("deal")}
        placeholder={t("deal")}
        options={options}
        disabled={disabled || options.length === 0}
        onChange={(value) => onChoose(options.find((option) => option.value === value) ?? null)}
      />
      {trimmed.length < 2 && (
        <p className={statusClass ?? "text-muted-foreground"}>{t("searchHint")}</p>
      )}
      {search.isFetching && (
        <p role="status" className={statusClass}>
          {t("searchLoading")}
        </p>
      )}
      {trimmed.length > 1 && options.length === 0 && !search.isFetching && !search.isError && (
        <p role="status" className={statusClass}>
          {t("noResults")}
        </p>
      )}
      {search.isError && (
        <p
          role="alert"
          className={feedback === "muted" ? "text-sm text-destructive" : "text-destructive"}
        >
          {t("loadError")}
        </p>
      )}
    </>
  );
}
