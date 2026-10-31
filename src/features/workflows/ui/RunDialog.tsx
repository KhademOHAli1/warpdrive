"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";
import { runWorkflowAction } from "../actions";

export function RunDialog({
  workflowId,
  mode,
  onClose,
  onStarted,
}: {
  workflowId: string;
  mode: "simulation" | "live";
  onClose: () => void;
  onStarted: () => void;
}) {
  const t = useAppTranslations("workflows");
  const [query, setQuery] = useState("");
  const [dealId, setDealId] = useState("");
  const [chosen, setChosen] = useState<{ value: string; label: string } | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const search = trpc.search.query.useQuery(
    { q: query.trim().slice(0, 200) },
    { enabled: query.trim().length > 1 },
  );
  const options = (search.data?.deals ?? []).map((deal) => ({
    value: deal.id,
    label: deal.primary,
  }));
  if (chosen !== null && !options.some((option) => option.value === chosen.value))
    options.unshift(chosen);
  async function run() {
    setPending(true);
    setError(false);
    try {
      const result = await runWorkflowAction(
        { workflowId, requestKey: key, recordId: dealId, mode },
        readCsrfToken(),
      );
      if (!result.ok) {
        setError(true);
        return;
      }
      onStarted();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value && !pending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("runTitle")}</DialogTitle>
          <DialogDescription>
            {t(mode === "simulation" ? "simulationHint" : "liveHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            {t("publishedHint")}
          </p>
          <Input
            aria-label={t("search")}
            placeholder={t("search")}
            value={query}
            maxLength={200}
            disabled={pending}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select
            value={dealId}
            ariaLabel={t("deal")}
            placeholder={t("deal")}
            options={options}
            disabled={pending}
            onChange={(value) => {
              setDealId(value);
              setChosen(options.find((option) => option.value === value) ?? null);
            }}
          />
          {query.trim().length > 1 && options.length === 0 && !search.isFetching && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("noResults")}
            </p>
          )}
          {search.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t("loadError")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t("runError")}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button disabled={pending || dealId === ""} onClick={() => void run()}>
              {t(mode === "simulation" ? "confirmSimulation" : "confirmLive")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
