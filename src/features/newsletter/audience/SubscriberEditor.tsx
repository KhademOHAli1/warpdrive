"use client";

import { type FormEvent, useId, useState } from "react";
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
import { Textarea } from "@/components/ui/Textarea";
import { useNewsletterRead, useNewsletterWrite } from "@/features/newsletter/ui/client";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { AudienceListPicker, AudienceWriteError } from "./components";
import { type MinimalList, newSubscriberStatus, type Subscriber } from "./contracts";
import { useAudienceMessages } from "./messages";

function validAttributes(value: string): boolean {
  try {
    const data: unknown = JSON.parse(value);
    return typeof data === "object" && data !== null && !Array.isArray(data);
  } catch {
    return false;
  }
}

export function SubscriberEditor({ row, close }: { row: Subscriber | null; close: () => void }) {
  const L = useAudienceMessages();
  const prefix = useId();
  const [name, setName] = useState(row?.name ?? "");
  const [email, setEmail] = useState(row?.email ?? "");
  const [status, setStatus] = useState<(typeof newSubscriberStatus.options)[number]>("enabled");
  const [lists, setLists] = useState<number[]>([]);
  const [attribs, setAttribs] = useState(JSON.stringify(row?.attribs ?? {}, null, 2));
  const [invalidAttributes, setInvalidAttributes] = useState(false);
  const available = useNewsletterRead<MinimalList[]>("lists.minimal", {}, row === null);
  const write = useNewsletterWrite();

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (write.isPending) return;
    if (!validAttributes(attribs)) {
      setInvalidAttributes(true);
      return;
    }
    setInvalidAttributes(false);
    const command = row
      ? write.run("subscribers.update", { id: row.id, name, attribs })
      : write.run("subscribers.create", { email: email.trim(), name, status, lists, attribs });
    void command.then(close).catch(() => undefined);
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !write.isPending) close();
      }}
    >
      <DialogContent className={`max-h-[90dvh] overflow-y-auto ${BLOCK_CLASS} ph-no-capture`}>
        <DialogHeader>
          <DialogTitle>{row ? L.editSubscriber : L.newSubscriber}</DialogTitle>
          <DialogDescription>{L.subscriberForm}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={save}>
          <label className="block space-y-1.5" htmlFor={`${prefix}-email`}>
            <span className="text-sm font-medium">{L.email}</span>
            <Input
              id={`${prefix}-email`}
              type="email"
              dir="ltr"
              required
              maxLength={254}
              readOnly={row !== null}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {row && <span className="block text-sm text-muted-foreground">{L.emailFixed}</span>}
          </label>
          <label className="block space-y-1.5" htmlFor={`${prefix}-name`}>
            <span className="text-sm font-medium">{L.name}</span>
            <Input
              id={`${prefix}-name`}
              required={row !== null}
              value={name}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {row === null && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{L.status}</p>
              <Select
                ariaLabel={L.status}
                value={status}
                onChange={(value) => setStatus(newSubscriberStatus.parse(value))}
                options={newSubscriberStatus.options.map((value) => ({ value, label: L[value] }))}
              />
            </div>
          )}
          <label className="block space-y-1.5" htmlFor={`${prefix}-attributes`}>
            <span className="text-sm font-medium">{L.attributes}</span>
            <Textarea
              id={`${prefix}-attributes`}
              dir="ltr"
              value={attribs}
              maxLength={16000}
              rows={3}
              aria-invalid={invalidAttributes}
              aria-describedby={`${prefix}-attributes-hint`}
              onChange={(event) => {
                setAttribs(event.target.value);
                setInvalidAttributes(false);
              }}
            />
            <span
              id={`${prefix}-attributes-hint`}
              className={`block text-sm ${invalidAttributes ? "text-destructive" : "text-muted-foreground"}`}
            >
              {L.attributesHint}
            </span>
          </label>
          {row === null && (
            <AudienceListPicker
              lists={available.data ?? []}
              value={lists}
              onChange={setLists}
              read={available}
            />
          )}
          <AudienceWriteError error={write.error} />
          <DialogFooter>
            <Button variant="outline" disabled={write.isPending} onClick={close}>
              {L.cancel}
            </Button>
            <Button type="submit" disabled={write.isPending}>
              {L.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
