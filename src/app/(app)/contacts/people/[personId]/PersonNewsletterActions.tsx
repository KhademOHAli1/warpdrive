"use client";

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
import { Select } from "@/components/ui/Select";
import { personNewsletterMessages } from "@/features/contacts/personNewsletterMessages";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { useNativeActor } from "@/features/identity/NativeActorProvider";
import type { IdentityCommandResult } from "@/features/newsletter/identity/contracts";
import { MASK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { readCsrfToken } from "@/utils/csrfCookie";

export type PersonNewsletterAction =
  | { kind: "verify"; address: string }
  | { kind: "reconcile"; linkId: string; address: string }
  | { kind: "invite"; linkId: string; address: string; lists: Array<{ id: number; name: string }> }
  | { kind: "detach"; linkId: string; address: string };

const evidencePattern =
  /^(?:[1-9][0-9]{0,15}|[A-Z]{2,12}-[0-9]{1,16}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$/;

function commandKey(actorId: string, personId: string, action: PersonNewsletterAction): string {
  // Addresses and evidence stay out of tab storage. The service binds the exact request to its ID.
  const link = "linkId" in action ? `:${action.linkId}` : "";
  return `warpdrive:newsletter:person:v1:${actorId}:${personId}:${action.kind}${link}`;
}

function storedId(key: string, fallback: string | null): string {
  try {
    const existing = sessionStorage.getItem(key);
    if (existing !== null) return existing;
    const id = fallback ?? crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return fallback ?? crypto.randomUUID();
  }
}

export function PersonNewsletterActions({
  action,
  personId,
  onClose,
  onResult,
}: {
  action: PersonNewsletterAction;
  personId: string;
  onClose: () => void;
  onResult: (result: IdentityCommandResult) => void;
}) {
  const L = personNewsletterMessages[useLocale()];
  const actor = useNativeActor();
  const evidenceId = useId();
  const [evidenceReference, setEvidenceReference] = useState("");
  const [listId, setListId] = useState<number>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const fallback = useRef<string | null>(null);
  const verify = trpc.newsletter.identity.beginProof.useMutation({ retry: false });
  const reconcile = trpc.newsletter.identity.reconcile.useMutation({ retry: false });
  const invite = trpc.newsletter.identity.invite.useMutation({ retry: false });
  const detach = trpc.newsletter.identity.detach.useMutation({ retry: false });
  const evidence = evidenceReference.trim();
  const formReady =
    (action.kind !== "verify" || evidencePattern.test(evidence)) &&
    (action.kind !== "invite" || listId !== undefined);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!formReady || busy.current || actor.actorId === null || !actor.isCurrent()) return;
    const key = commandKey(actor.actorId, personId, action);
    const operationId = storedId(key, fallback.current);
    const base = { personId, operationId, csrfToken: readCsrfToken() };
    fallback.current = operationId;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      let result: IdentityCommandResult;
      switch (action.kind) {
        case "verify":
          result = await verify.mutateAsync({
            ...base,
            address: action.address,
            evidenceReference: evidence,
          });
          break;
        case "reconcile":
          result = await reconcile.mutateAsync({ ...base, claimId: action.linkId });
          break;
        case "invite":
          if (listId === undefined) return;
          result = await invite.mutateAsync({ ...base, linkId: action.linkId, listId });
          break;
        case "detach":
          result = await detach.mutateAsync({ ...base, linkId: action.linkId });
          break;
      }
      if (!actor.isCurrent()) return;
      if (result.state === "unknown") {
        setError(operationId);
        return;
      }
      try {
        if (sessionStorage.getItem(key) === operationId) sessionStorage.removeItem(key);
      } catch {
        // The current dialog's fallback retains the ID only for unresolved results.
      }
      fallback.current = null;
      onResult(result);
    } catch {
      if (actor.isCurrent()) setError(operationId);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{L.actions[action.kind]}</DialogTitle>
            <DialogDescription>{L.actionDescriptions[action.kind]}</DialogDescription>
          </DialogHeader>
          <bdi className={`block text-sm ${MASK_CLASS}`}>{action.address}</bdi>
          {action.kind === "verify" && (
            <label htmlFor={evidenceId} className="block space-y-2 text-sm">
              <span>{L.evidenceReference}</span>
              <Input
                id={evidenceId}
                className={MASK_CLASS}
                value={evidenceReference}
                maxLength={36}
                disabled={pending}
                dir="ltr"
                onChange={(event) => setEvidenceReference(event.target.value)}
              />
            </label>
          )}
          {action.kind === "invite" && (
            <Select
              ariaLabel={L.list}
              placeholder={L.list}
              value={listId === undefined ? "" : String(listId)}
              options={action.lists.map((list) => ({ value: String(list.id), label: list.name }))}
              disabled={pending}
              onChange={(value) =>
                setListId(action.lists.find((list) => String(list.id) === value)?.id)
              }
            />
          )}
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {L.actionError} <code dir="ltr">{error}</code>
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
              {L.close}
            </Button>
            <Button type="submit" disabled={!formReady || pending}>
              {L.actions[action.kind]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
