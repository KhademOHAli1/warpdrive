"use client";

import { ClipboardList, ExternalLink } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { ReturnDetail, ReturnSource, ReturnsWorkspace } from "../contracts";
import { returnPartLabel, useReturnDisplay } from "./display";
import type { ReturnMessages } from "./messages";
import { ReturnStatusBadge } from "./ReturnBrowse";
import { ReturnPaperwork } from "./ReturnPaperwork";
import {
  canSetPhysicalDisposition,
  type OpenReturnEditor,
  type ReturnLine,
  type ReturnReceipt,
  returnLifecycle,
} from "./types";

const labels = {
  issue: "issue",
  hold: "hold",
  resume: "resume",
  duplicate: "duplicate",
  cancel: "cancelReturn",
  complete: "complete",
} as const;
const lifecycleActions = ["issue", "hold", "resume", "duplicate", "cancel", "complete"] as const;

function ReturnToolbar({
  detail,
  canEditDraft,
  open,
  busy,
  paperworkButton,
  t,
}: {
  detail: ReturnDetail;
  canEditDraft: boolean;
  open: OpenReturnEditor;
  busy: boolean;
  paperworkButton: ReactNode;
  t: ReturnMessages;
}) {
  const allowed = returnLifecycle(detail);
  return (
    <div className="flex flex-wrap gap-2">
      {lifecycleActions.map((type) => {
        if (!allowed[type]) return null;
        return (
          <Button
            key={type}
            data-return-action={type}
            type="button"
            size="sm"
            variant={type === "issue" ? "default" : "outline"}
            disabled={busy}
            onClick={(event) => open(event, { type, detail })}
          >
            {t[labels[type]]}
          </Button>
        );
      })}
      {canEditDraft && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-return-action="saveDraft"
          disabled={busy}
          onClick={(event) => open(event, { type: "saveDraft", detail })}
        >
          {t.editDraft}
        </Button>
      )}
      {paperworkButton}
    </div>
  );
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

function Overview({
  detail,
  source,
  site,
  t,
}: {
  detail: ReturnDetail;
  source: ReturnSource | null;
  site: string;
  t: ReturnMessages;
}) {
  const f = useReturnDisplay();
  const currency = detail.currency;
  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Term label={t.site}>
          <bdi>{site}</bdi>
        </Term>
        <Term label={t.shipment}>
          <bdi>{detail.shipmentReference}</bdi>
        </Term>
        <Term label={t.created}>
          <time dateTime={detail.createdAt}>{f.date(detail.createdAt)}</time>
        </Term>
        {source !== null && (
          <Term label={t.order}>
            <Link
              className="inline-flex items-center gap-1 text-primary hover:underline"
              href={`/inventory/sales-orders?orderId=${encodeURIComponent(source.orderId)}`}
              prefetch={false}
            >
              <bdi>{source.orderReference}</bdi>
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </Link>
          </Term>
        )}
        {source?.customerName != null && (
          <Term label={t.customer}>
            <bdi>{source.customerName}</bdi>
          </Term>
        )}
        {detail.note !== null && (
          <Term label={t.note}>
            <bdi className="whitespace-pre-line">{detail.note}</bdi>
          </Term>
        )}
      </dl>
      {detail.charges !== null && currency !== null && detail.charges.length > 0 && (
        <div className="space-y-1.5 border-t pt-3">
          <h3 className="text-sm font-medium">{t.extraCharges}</h3>
          <dl className="max-w-sm text-sm">
            {detail.charges.map(({ label, amount }) => (
              <div key={label} className="flex justify-between gap-3">
                <dt>
                  <bdi>{label}</bdi>
                </dt>
                <dd>
                  <bdi>{f.amount(amount, currency)}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}

function ReceiptCommercial({
  receipt,
  currency,
  t,
}: {
  receipt: ReturnReceipt;
  currency: string | null;
  t: ReturnMessages;
}) {
  const f = useReturnDisplay();
  const commercial = receipt.commercial;
  if (commercial === null) return null;
  return (
    <div className="text-sm" data-return-commercial-kind={commercial.kind}>
      <p className="font-medium">{t[commercial.kind]}</p>
      {commercial.amount !== null && currency !== null && (
        <p>
          <bdi>{f.amount(commercial.amount, currency)}</bdi>
        </p>
      )}
      {commercial.reference !== null && (
        <p>
          <bdi>{commercial.reference}</bdi>
        </p>
      )}
      <p className="break-words text-muted-foreground">
        <bdi>{commercial.reason}</bdi>
      </p>
    </div>
  );
}

function Receipt({
  receipt,
  detail,
  open,
  busy,
  t,
}: {
  receipt: ReturnReceipt;
  detail: ReturnDetail;
  open: OpenReturnEditor;
  busy: boolean;
  t: ReturnMessages;
}) {
  const f = useReturnDisplay();
  return (
    <li
      data-return-receipt-id={receipt.id}
      data-return-receipt-state={receipt.physical}
      className="space-y-2.5 bg-muted/25 p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{t[receipt.physical]}</Badge>
            <span>
              {f.quantity(receipt.quantity)} · {t[receipt.condition]}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            <time dateTime={receipt.receivedAt}>{f.date(receipt.receivedAt)}</time>
            {receipt.location !== "" && (
              <>
                {" "}
                · <bdi>{receipt.location}</bdi>
              </>
            )}
          </p>
          {receipt.note !== null && (
            <p className="break-words">
              <bdi>{receipt.note}</bdi>
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {detail.canDispose && canSetPhysicalDisposition(receipt) && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-return-action="disposition"
              disabled={busy}
              onClick={(event) => open(event, { type: "disposition", detail, receipt })}
            >
              {t.dispose}
            </Button>
          )}
          {detail.canCommercial && receipt.commercial === null && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-return-action="commercial"
              disabled={busy}
              onClick={(event) => open(event, { type: "commercial", detail, receipt })}
            >
              {t.commercial}
            </Button>
          )}
        </div>
      </div>
      <ReceiptCommercial receipt={receipt} currency={detail.currency} t={t} />
      {receipt.eventId.length > 0 && (
        <Link
          href={`/inventory/warehouse/operations?movementId=${encodeURIComponent(receipt.eventId)}`}
          prefetch={false}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {t.openMovement}
          <ExternalLink className="size-3" aria-hidden="true" />
        </Link>
      )}
    </li>
  );
}

function Item({
  line,
  detail,
  open,
  hasBins,
  busy,
  t,
}: {
  line: ReturnLine;
  detail: ReturnDetail;
  open: OpenReturnEditor;
  hasBins: boolean;
  busy: boolean;
  t: ReturnMessages;
}) {
  const f = useReturnDisplay();
  return (
    <li data-return-line-id={line.id} className="space-y-3 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1 text-sm">
          <p className="break-words font-medium">
            <bdi>
              {returnPartLabel(line)} · {line.name}
            </bdi>
          </p>
          <p className="break-words text-muted-foreground">
            <bdi>{line.reason}</bdi>
          </p>
          <p className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span>
              {t.requested} {f.quantity(line.quantity)}
            </span>
            <span data-return-received={line.received}>
              {t.received} {f.quantity(line.received)}
            </span>
          </p>
        </div>
        {detail.canReceive && detail.status === "issued" && line.received < line.quantity && (
          <Button
            type="button"
            size="sm"
            data-return-action="receive"
            disabled={busy || !hasBins}
            onClick={(event) => open(event, { type: "receive", detail, line })}
          >
            {t.receive}
          </Button>
        )}
      </div>
      {line.receipts.length > 0 && (
        <ul aria-label={t.receipt} className="divide-y overflow-hidden rounded-md border">
          {line.receipts.map((receipt) => (
            <Receipt key={receipt.id} {...{ receipt, detail, open, busy, t }} />
          ))}
        </ul>
      )}
    </li>
  );
}

const historyLabels = {
  ...labels,
  saveDraft: "editDraft",
  receive: "received",
  disposition: "dispositions",
  commercial: "commercial",
} as const;

function ReturnHistory({ detail, t }: { detail: ReturnDetail; t: ReturnMessages }) {
  const f = useReturnDisplay();
  if (detail.history.length === 0) return null;
  return (
    <section className="rounded-lg border bg-card">
      <h3 className="border-b px-3 py-2 text-sm font-medium">{t.activity}</h3>
      <ul className="divide-y">
        {detail.history.map((event) => (
          <li key={event.id} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <p>{t[historyLabels[event.type]]}</p>
              {event.reason !== null && (
                <p className="break-words text-xs text-muted-foreground">
                  <bdi>{event.reason}</bdi>
                </p>
              )}
            </div>
            <time dateTime={event.at} className="text-xs text-muted-foreground">
              {f.date(event.at)}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ReturnDetailView({
  detail,
  workspace,
  busy,
  open,
  t,
}: {
  detail: ReturnDetail;
  workspace: ReturnsWorkspace;
  busy: boolean;
  open: OpenReturnEditor;
  t: ReturnMessages;
}) {
  const [paperwork, setPaperwork] = useState(false);
  const openPaperwork = useRef<HTMLButtonElement>(null);
  const site = workspace.sites.find(({ id }) => id === detail.siteId)?.name ?? "—";
  const source = workspace.source?.id === detail.shipmentId ? workspace.source : null;
  const canEditDraft = detail.status === "draft" && detail.canEdit && source !== null;
  const hasBins = workspace.bins.some(({ siteId }) => siteId === detail.siteId);
  const paperworkButton = (
    <Button
      ref={openPaperwork}
      type="button"
      size="sm"
      variant="outline"
      data-return-action="paperwork"
      disabled={busy}
      onClick={() => setPaperwork(true)}
    >
      <ClipboardList className="size-4" aria-hidden="true" />
      {t.viewPaperwork}
    </Button>
  );
  return (
    <article
      id="return-case"
      data-return-case-id={detail.id}
      data-return-status={detail.status}
      className="scroll-mt-3 space-y-3"
    >
      <section className="space-y-3 rounded-lg border bg-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 break-words text-lg font-semibold">
              <bdi>{detail.reference}</bdi>
            </h2>
            <ReturnStatusBadge status={detail.status} t={t} />
          </div>
          <ReturnToolbar {...{ detail, canEditDraft, open, busy, paperworkButton, t }} />
        </div>
        <Overview {...{ detail, source, site, t }} />
      </section>
      <section className="rounded-lg border bg-card">
        <h3 className="border-b px-3 py-2 text-sm font-medium">{t.caseItems}</h3>
        {detail.lines.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{t.noSourceLines}</p>
        ) : (
          <ul className="divide-y">
            {detail.lines.map((line) => (
              <Item key={line.id} {...{ line, detail, open, hasBins, busy, t }} />
            ))}
          </ul>
        )}
      </section>
      <ReturnHistory {...{ detail, t }} />
      {paperwork && (
        <ReturnPaperwork
          {...{ detail, source, site, t }}
          close={() => setPaperwork(false)}
          restoreFocus={() => openPaperwork.current?.focus()}
        />
      )}
    </article>
  );
}
