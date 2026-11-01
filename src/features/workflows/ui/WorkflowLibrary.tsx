"use client";

import { ArrowUpRight, GitBranch, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type MouseEvent, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
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
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";
import { createWorkflowAction } from "../actions";
import { initialBlankDefinition, initialDefinition } from "../editorModel";
import { useDialogFocus } from "./useDialogFocus";

export function WorkflowLibrary({ canCreate }: { canCreate: boolean }) {
  const t = useAppTranslations("workflows");
  const fmt = useFormatters();
  const router = useRouter();
  const list = trpc.workflows.list.useQuery();
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState("followUp");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const id = useId();
  const focus = useDialogFocus();
  const newWorkflow = useRef<HTMLButtonElement>(null);
  async function create() {
    setPending(true);
    setError(false);
    try {
      const result = await createWorkflowAction(
        {
          name,
          definition:
            template === "blank"
              ? initialBlankDefinition(t("start"))
              : initialDefinition({
                  start: t("start"),
                  read: t("read"),
                  task: t("task"),
                  subject: t("subject"),
                }),
        },
        readCsrfToken(),
      );
      if (!result.ok) {
        setError(true);
        return;
      }
      router.push(`/workflows/${result.value.id}`);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  function start(event: MouseEvent<HTMLButtonElement>) {
    focus.remember(event.currentTarget);
    setName(t("defaultName"));
    setError(false);
    setOpen(true);
  }
  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-display font-semibold tracking-tight">{t("title")}</h1>
            <Badge variant="outline">{t("early")}</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canCreate && (
          <Button ref={newWorkflow} onClick={start}>
            <Plus className="size-4" />
            {t("new")}
          </Button>
        )}
      </header>
      <p className="rounded-lg border border-primary/15 bg-primary/5 px-5 py-4 text-sm leading-6 text-muted-foreground">
        {t("scope")}
      </p>
      {list.isLoading && <p role="status">{t("loading")}</p>}
      {list.isError && (
        <div role="alert" className="space-y-3 rounded-lg border bg-card p-6">
          <p>{t("loadError")}</p>
          <Button variant="outline" onClick={() => void list.refetch()}>
            {t("retry")}
          </Button>
        </div>
      )}
      {list.data?.length === 0 && (
        <div className="flex min-h-80 flex-col items-center justify-center rounded-lg border bg-card p-8 text-center">
          <GitBranch className="mb-5 size-9 text-primary" />
          <h2 className="text-lg font-semibold">{t("empty")}</h2>
          <p className="mb-6 mt-2 text-sm text-muted-foreground">{t("emptyHint")}</p>
          {canCreate && <Button onClick={start}>{t("new")}</Button>}
        </div>
      )}
      {(list.data?.length ?? 0) > 0 && (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="hidden grid-cols-[1fr_140px_200px_32px] gap-5 border-b px-6 py-3 text-xs font-medium text-muted-foreground md:grid">
            <span>{t("name")}</span>
            <span>{t("published")}</span>
            <span>{t("updated")}</span>
            <span />
          </div>
          {list.data?.map((row) => (
            <Link
              key={row.id}
              href={`/workflows/${row.id}`}
              className="flex items-center gap-5 border-b px-6 py-5 transition-colors last:border-0 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid md:grid-cols-[1fr_140px_200px_32px]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <div className="rounded-lg border bg-muted/40 p-3 text-primary">
                  <GitBranch className="size-5" />
                </div>
                <bdi className="block truncate text-sm font-semibold">{row.name}</bdi>
              </div>
              <Badge variant={row.active ? "success" : "secondary"}>
                {row.active ? t("active") : row.publishedNumber === null ? t("draft") : t("paused")}
              </Badge>
              <span className="hidden text-xs text-muted-foreground md:block">
                {fmt.dateTime(row.updatedAt)}
              </span>
              <ArrowUpRight aria-hidden className="hidden size-4 text-muted-foreground md:block" />
            </Link>
          ))}
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!pending) setOpen(value);
        }}
      >
        <DialogContent onCloseAutoFocus={(event) => focus.restore(event, newWorkflow.current)}>
          <DialogHeader>
            <DialogTitle>{t("new")}</DialogTitle>
            <DialogDescription>{t("createHint")}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
            className="space-y-5"
          >
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("template")}</p>
              <Select
                ariaLabel={t("template")}
                value={template}
                disabled={pending}
                options={[
                  { value: "followUp", label: t("followUpTemplate") },
                  { value: "blank", label: t("blankTemplate") },
                ]}
                onChange={setTemplate}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor={id}>
                {t("name")}
              </label>
              <Input
                dir="auto"
                id={id}
                value={name}
                maxLength={120}
                required
                disabled={pending}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {t("error")}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={pending || name.trim().length === 0}>
                {t("create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
