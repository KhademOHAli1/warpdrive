"use client";

import { sanitize } from "isomorphic-dompurify";
import Link from "next/link";
import type { ReactNode } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button, buttonVariants } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useFormatters } from "@/lib/useFormatters";
import { useCampaignMessages } from "./messages";

export const panelClass = "rounded-lg border bg-card";
export const tableClass = "w-full border-collapse text-start text-sm";
export const headClass = "border-b bg-muted/45 text-start text-xs text-muted-foreground";
export const cellClass = "px-4 py-3 text-start";

export function CampaignHeading({ title, actions }: { title: string; actions?: ReactNode }) {
  const m = useCampaignMessages();
  return (
    <PageHeading
      title={title}
      crumbs={[{ label: m.campaigns, href: "/campaigns" }, { label: title }]}
      actions={actions}
    />
  );
}

export function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={buttonVariants()}>
      {children}
    </Link>
  );
}

export function Field({
  label,
  children,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

export function QueryState({
  loading,
  error,
  retry,
  empty,
  children,
}: {
  loading: boolean;
  error: unknown;
  retry?: () => void;
  empty?: string;
  children: ReactNode;
}) {
  const m = useCampaignMessages();
  if (loading)
    return (
      <div role="status" aria-label={m.loading} className="grid gap-2">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  if (error != null)
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/35 px-4 py-3 text-sm"
      >
        <span>{m.loadError}</span>
        {retry && (
          <Button size="sm" variant="outline" onClick={retry}>
            {m.retry}
          </Button>
        )}
      </div>
    );
  if (empty !== undefined) return <EmptyState title={empty} body="" />;
  return children;
}

export function WriteMessage({ error, success }: { error: unknown; success?: string }) {
  const m = useCampaignMessages();
  if (error != null)
    return (
      <p role="alert" className="text-sm text-destructive">
        {m.writeError}
      </p>
    );
  if (success !== undefined)
    return (
      <p role="status" className="text-sm text-success">
        {success}
      </p>
    );
  return null;
}

export function Pager({
  page,
  perPage,
  total,
  onChange,
}: {
  page: number;
  perPage: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const m = useCampaignMessages();
  const f = useFormatters();
  const lastPage = Math.max(1, Math.ceil(total / Math.max(1, perPage)));
  if (page <= 1 && lastPage <= 1) return null;
  return (
    <nav
      className="flex flex-wrap items-center justify-end gap-3 border-t px-4 py-2"
      aria-label={m.page}
    >
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        {m.previous}
      </Button>
      <span className="text-sm text-muted-foreground">
        {m.page} {f.number(page)} / {f.number(lastPage)}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={page >= lastPage}
        onClick={() => onChange(page + 1)}
      >
        {m.next}
      </Button>
    </nav>
  );
}

export function DeleteConfirmation({
  open,
  onClose,
  onConfirm,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  const m = useCampaignMessages();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={m.deleteConfirm}
      description={m.deleteBody}
      confirmLabel={m.delete}
      onConfirm={onConfirm}
      pending={pending}
      destructive
    />
  );
}

const previewCsp =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

export function NewsletterPreview({ body, plain }: { body: string; plain?: boolean }) {
  const m = useCampaignMessages();
  if (plain === true)
    return (
      <pre className="min-h-44 whitespace-pre-wrap rounded-md border p-4 text-sm" dir="auto">
        {body}
      </pre>
    );
  const html = sanitize(body, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["base", "meta", "link", "form", "iframe", "object", "embed", "video", "audio"],
    FORBID_ATTR: ["href", "target", "srcdoc", "action", "formaction", "ping", "srcset"],
  });
  return (
    <iframe
      className="h-[26rem] w-full rounded-md border bg-white"
      title={m.previewTitle}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${previewCsp}"><meta charset="utf-8"><style>body{font:14px system-ui;padding:16px}a{pointer-events:none}img{max-width:100%}</style></head><body>${html}</body></html>`}
    />
  );
}
