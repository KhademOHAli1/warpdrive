"use client";

import { type FormEvent, useId, useState } from "react";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type { NewsletterReceiptResolution, NewsletterReceiptView } from "../operationReceipts";
import {
  useNewsletterReceipt,
  useNewsletterReceiptResolution,
  usePendingNewsletterReceiptIds,
} from "../ui/client";
import { receiptMessages } from "./receiptMessages";

type Labels = (typeof receiptMessages)[keyof typeof receiptMessages];
const operationIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const evidenceReferencePattern =
  /^(?:[1-9][0-9]{0,15}|[A-Z]{2,12}-[0-9]{1,16}|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$/;
const outcomes = ["applied", "notApplied"] as const;
const sources = ["engineRecord", "engineLog", "deliveryLog", "importStatus"] as const;

function ResolutionForm({ receipt, L }: { receipt: NewsletterReceiptView; L: Labels }) {
  const evidenceId = useId();
  const [outcome, setOutcome] = useState<NewsletterReceiptResolution["outcome"] | undefined>();
  const [source, setSource] = useState<NewsletterReceiptResolution["evidenceSource"] | undefined>();
  const [reference, setReference] = useState("");
  const review = useNewsletterReceiptResolution();
  const evidenceReference = reference.trim();
  const canSave =
    outcome !== undefined &&
    source !== undefined &&
    evidenceReferencePattern.test(evidenceReference);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (outcome === undefined || source === undefined || !canSave || review.isPending) return;
    void review
      .run(receipt.operationId, { outcome, evidenceSource: source, evidenceReference })
      .catch(() => undefined);
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-t pt-4">
      <p className="text-sm text-muted-foreground">{L.instructions}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          value={outcome ?? ""}
          options={outcomes.map((value) => ({ value, label: L.outcomes[value] }))}
          ariaLabel={L.outcome}
          placeholder={L.outcome}
          disabled={review.isPending}
          onChange={(value) => setOutcome(outcomes.find((item) => item === value))}
        />
        <Select
          value={source ?? ""}
          options={sources.map((value) => ({ value, label: L.evidence[value] }))}
          ariaLabel={L.evidenceSource}
          placeholder={L.evidenceSource}
          disabled={review.isPending}
          onChange={(value) => setSource(sources.find((item) => item === value))}
        />
        <Input
          id={evidenceId}
          aria-label={L.evidenceId}
          placeholder={L.evidenceId}
          dir="ltr"
          maxLength={36}
          value={reference}
          disabled={review.isPending}
          onChange={(event) => setReference(event.target.value)}
        />
      </div>
      {review.error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {L.saveError}
        </p>
      )}
      <Button type="submit" disabled={!canSave || review.isPending}>
        {L.save}
      </Button>
    </form>
  );
}

function ReceiptDetails({ receipt, L }: { receipt: NewsletterReceiptView; L: Labels }) {
  const resolution = receipt.resolution;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <code dir="ltr">{receipt.operation}</code> · {L.state[receipt.state]}
      </p>
      {resolution !== null && (
        <p role="status" className="text-sm">
          {L.outcomes[resolution.outcome]} · {L.evidence[resolution.evidenceSource]} ·{" "}
          <bdi dir="ltr">{resolution.evidenceReference}</bdi>
        </p>
      )}
      {receipt.reviewAvailable && (
        <ResolutionForm key={receipt.operationId} receipt={receipt} L={L} />
      )}
    </div>
  );
}

export function ReceiptReview() {
  const L = receiptMessages[useLocale()];
  const labelId = useId();
  const [input, setInput] = useState("");
  const [operationId, setOperationId] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const query = useNewsletterReceipt(operationId);
  const pendingIds = usePendingNewsletterReceiptIds();

  function lookup(event: FormEvent) {
    event.preventDefault();
    const id = input.trim();
    const valid = operationIdPattern.test(id);
    setInvalid(!valid);
    if (!valid) return;
    showReceipt(id);
  }

  function showReceipt(id: string) {
    setInput(id);
    setInvalid(false);
    if (operationId === id) void query.refetch();
    else setOperationId(id);
  }

  return (
    <SettingsCard>
      <SettingsCardHeader title={L.title} />
      <SettingsCardBody className="space-y-4">
        <form onSubmit={lookup} className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1 space-y-1">
            <label htmlFor={labelId} className="text-sm font-medium">
              {L.id}
            </label>
            <Input
              id={labelId}
              dir="ltr"
              value={input}
              maxLength={36}
              autoComplete="off"
              onChange={(event) => setInput(event.target.value)}
            />
          </div>
          <Button type="submit" variant="outline" disabled={query.isFetching}>
            {L.lookup}
          </Button>
        </form>
        {pendingIds.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{L.pending}</p>
            <ul className="flex flex-wrap gap-2">
              {pendingIds.map((id) => (
                <li key={id}>
                  <Button type="button" size="sm" variant="outline" onClick={() => showReceipt(id)}>
                    <code dir="ltr">{id}</code>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            {L.badId}
          </p>
        )}
        {operationId !== null && query.isPending && (
          <p role="status" className="text-sm">
            {L.loading}
          </p>
        )}
        {query.isError && (
          <p role="alert" className="text-sm text-destructive">
            {L.readError}
          </p>
        )}
        {query.data === null && (
          <p role="status" className="text-sm">
            {L.noReceipt}
          </p>
        )}
        {query.data && <ReceiptDetails receipt={query.data} L={L} />}
      </SettingsCardBody>
    </SettingsCard>
  );
}
