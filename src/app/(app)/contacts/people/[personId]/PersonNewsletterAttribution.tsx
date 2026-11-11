"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useRef, useState } from "react";
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
import { personNewsletterMessages } from "@/features/contacts/personNewsletterMessages";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useNativeActor } from "@/features/identity/NativeActorProvider";
import { MASK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { readCsrfToken } from "@/utils/csrfCookie";

type Exposure = { bindingId: string; deliveryId: string; campaignName: string; acceptedAt: Date };

function CreateAttributedLead({
  personId,
  exposure,
  onClose,
}: {
  personId: string;
  exposure: Exposure;
  onClose: () => void;
}) {
  const L = personNewsletterMessages[useLocale()].attribution;
  const router = useRouter();
  const actor = useNativeActor();
  const titleId = useId();
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState(false);
  const idRef = useRef<string | null>(null);
  const busy = useRef(false);
  const mutation = trpc.newsletter.attribution.createLead.useMutation({ retry: false });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      created ||
      title.trim() === "" ||
      actor.actorId === null ||
      !actor.isCurrent() ||
      busy.current
    )
      return;
    busy.current = true;
    const key = `warpdrive:newsletter:lead:v1:${actor.actorId}:${personId}:${exposure.deliveryId}`;
    let operationId = idRef.current ?? crypto.randomUUID();
    try {
      operationId = sessionStorage.getItem(key) ?? operationId;
      sessionStorage.setItem(key, operationId);
    } catch {
      // The mounted dialog still retains the operation ID.
    }
    idRef.current = operationId;
    setError("");
    try {
      const result = await mutation.mutateAsync({
        personId,
        bindingId: exposure.bindingId,
        deliveryId: exposure.deliveryId,
        operationId,
        title,
        csrfToken: readCsrfToken(),
      });
      if (!actor.isCurrent()) return;
      try {
        if (sessionStorage.getItem(key) === operationId) sessionStorage.removeItem(key);
      } catch {
        // The completed operation is also recorded with the lead source on the server.
      }
      setCreated(true);
      if (result.id !== null) router.push(`/leads/${result.id}`);
    } catch {
      if (actor.isCurrent()) setError(operationId);
    } finally {
      busy.current = false;
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{L.createLead}</DialogTitle>
            <DialogDescription>{L.createDescription}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            <bdi>{exposure.campaignName}</bdi>
          </p>
          <label htmlFor={titleId} className="block space-y-2 text-sm">
            <span>{L.leadTitle}</span>
            <Input
              id={titleId}
              className={MASK_CLASS}
              value={title}
              disabled={mutation.isPending || created}
              maxLength={255}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {error !== "" && (
            <p role="alert" className="text-sm text-destructive">
              {L.createError} <code dir="ltr">{error}</code>
            </p>
          )}
          {created && (
            <p role="status" className="text-sm">
              {L.leadCreated}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
              {L.close}
            </Button>
            <Button type="submit" disabled={title.trim() === "" || mutation.isPending || created}>
              {L.createLead}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AttributionContents({
  personId,
  canCreateLead,
}: {
  personId: string;
  canCreateLead: boolean;
}) {
  const L = personNewsletterMessages[useLocale()].attribution;
  const format = useFormatters();
  const [chosen, setChosen] = useState<Exposure | null>(null);
  const query = trpc.newsletter.attribution.person.useQuery(
    { personId },
    { staleTime: 0, retry: false },
  );
  if (query.isPending)
    return (
      <p role="status" className="text-sm">
        {L.loading}
      </p>
    );
  const data = query.data?.personId === personId && !query.isError ? query.data : undefined;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">{L.coverage}</p>
      {data?.state !== "available" && (
        <p role="status" className="text-muted-foreground">
          {L.unavailable}
        </p>
      )}
      {data?.state === "available" && data.exposures.length === 0 && <p>{L.empty}</p>}
      {data && data.exposures.length > 0 && (
        <ul className="divide-y rounded-md border">
          {data.exposures.map((exposure) => (
            <li
              key={exposure.deliveryId}
              className="flex flex-wrap items-center justify-between gap-2 p-3"
            >
              <div className="grid gap-1">
                <bdi className="font-medium">{exposure.campaignName}</bdi>
                <time
                  dateTime={exposure.acceptedAt.toISOString()}
                  className="text-muted-foreground"
                >
                  {format.dateTime(exposure.acceptedAt)}
                </time>
              </div>
              {canCreateLead && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setChosen(exposure)}
                >
                  {L.createLead}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && data.wins.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-medium">{L.wins}</h3>
          <ul className="space-y-1">
            {data.wins.map((win) => (
              <li key={win.dealId} className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/deals/${win.dealId}`}
                  className={`text-link hover:underline ${MASK_CLASS}`}
                >
                  <bdi>{win.title}</bdi>
                </Link>
                <time dateTime={win.occurredAt.toISOString()} className="text-muted-foreground">
                  {format.dateTime(win.occurredAt)}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}
      {chosen !== null && (
        <CreateAttributedLead
          personId={personId}
          exposure={chosen}
          onClose={() => setChosen(null)}
        />
      )}
    </div>
  );
}

export function PersonNewsletterAttribution({
  personId,
  canCreateLead,
}: {
  personId: string;
  canCreateLead: boolean;
}) {
  const L = personNewsletterMessages[useLocale()].attribution;
  const [open, setOpen] = useState(false);
  return (
    <details
      className="space-y-3 rounded-md border p-4"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer font-medium">{L.title}</summary>
      {open && <AttributionContents personId={personId} canCreateLead={canCreateLead} />}
    </details>
  );
}
