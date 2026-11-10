"use client";

import type React from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { BillingMessages } from "../messages";
import type { BillingInterval } from "../stripe/schemas";
import type { BillingCountryOption, BillingDraft } from "./types";

export function BillingProfileForm({
  messages,
  draft,
  onChange,
  countries,
  interval,
  onIntervalChange,
  totalSeats,
  onTotalSeatsChange,
  onSubmit,
  pending,
  locked = false,
  error,
}: {
  messages: BillingMessages;
  draft: BillingDraft;
  onChange: <Key extends keyof BillingDraft>(key: Key, value: BillingDraft[Key]) => void;
  countries: BillingCountryOption[];
  interval: BillingInterval;
  onIntervalChange: (value: BillingInterval) => void;
  totalSeats: number;
  onTotalSeatsChange: (value: number) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  locked?: boolean;
  error?: string;
}): React.ReactNode {
  return (
    <form onSubmit={onSubmit} className="ph-no-capture ph-block-email space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={messages.name} htmlFor="billing-name">
          <Input
            id="billing-name"
            aria-label={messages.name}
            value={draft.name}
            autoComplete="organization"
            required
            disabled={locked}
            onChange={(event) => onChange("name", event.target.value)}
          />
        </Field>
        <Field label={messages.email} htmlFor="billing-email">
          <Input
            id="billing-email"
            aria-label={messages.email}
            type="email"
            value={draft.email}
            autoComplete="email"
            required
            disabled={locked}
            onChange={(event) => onChange("email", event.target.value)}
          />
        </Field>
        <Field label={messages.addressLine1} htmlFor="billing-address-line1">
          <Input
            id="billing-address-line1"
            aria-label={messages.addressLine1}
            value={draft.line1}
            autoComplete="address-line1"
            required
            disabled={locked}
            onChange={(event) => onChange("line1", event.target.value)}
          />
        </Field>
        <Field label={messages.addressLine2} htmlFor="billing-address-line2">
          <Input
            id="billing-address-line2"
            aria-label={messages.addressLine2}
            value={draft.line2}
            autoComplete="address-line2"
            disabled={locked}
            onChange={(event) => onChange("line2", event.target.value)}
          />
        </Field>
        <Field label={messages.city} htmlFor="billing-city">
          <Input
            id="billing-city"
            aria-label={messages.city}
            value={draft.city}
            autoComplete="address-level2"
            required
            disabled={locked}
            onChange={(event) => onChange("city", event.target.value)}
          />
        </Field>
        <Field label={messages.state} htmlFor="billing-state">
          <Input
            id="billing-state"
            aria-label={messages.state}
            value={draft.state}
            autoComplete="address-level1"
            disabled={locked}
            onChange={(event) => onChange("state", event.target.value)}
          />
        </Field>
        <Field label={messages.postalCode} htmlFor="billing-postal-code">
          <Input
            id="billing-postal-code"
            aria-label={messages.postalCode}
            value={draft.postalCode}
            autoComplete="postal-code"
            required
            disabled={locked}
            onChange={(event) => onChange("postalCode", event.target.value)}
          />
        </Field>
        <div>
          <span className="mb-1.5 block text-sm font-medium">{messages.country}</span>
          <Select
            value={draft.country}
            onChange={(value) => onChange("country", value)}
            options={countries}
            ariaLabel={messages.country}
            placeholder={messages.countryPlaceholder}
            contentClassName="ph-no-capture ph-block-email"
            disabled={locked}
          />
        </div>
        <Field label={messages.taxId} htmlFor="billing-tax-id">
          <Input
            id="billing-tax-id"
            aria-label={messages.taxId}
            value={draft.taxId}
            autoComplete="off"
            disabled={locked}
            onChange={(event) => onChange("taxId", event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
        <div>
          <span className="mb-1.5 block text-sm font-medium">{messages.interval}</span>
          <Select
            value={interval}
            onChange={(value) => onIntervalChange(value as BillingInterval)}
            options={[
              { value: "monthly", label: messages.monthly },
              { value: "yearly", label: messages.yearly },
            ]}
            ariaLabel={messages.interval}
            contentClassName="ph-no-capture ph-block-email"
            disabled={locked}
          />
        </div>
        <Field label={messages.totalSeats} htmlFor="billing-total-seats">
          <Input
            id="billing-total-seats"
            aria-label={messages.totalSeats}
            type="number"
            min={1}
            max={10000}
            step={1}
            value={totalSeats}
            disabled={locked}
            onChange={(event) => onTotalSeatsChange(Number(event.target.value))}
          />
        </Field>
      </div>

      <p className="text-sm text-muted-foreground">{messages.pricingAtCheckout}</p>
      {error !== undefined ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? messages.startingSubscription : messages.startSubscription}
      </Button>
    </form>
  );
}

export function BillingStartControls({
  messages,
  interval,
  onIntervalChange,
  totalSeats,
  onTotalSeatsChange,
  onSubmit,
  pending,
  locked = false,
  error,
}: {
  messages: BillingMessages;
  interval: BillingInterval;
  onIntervalChange: (value: BillingInterval) => void;
  totalSeats: number;
  onTotalSeatsChange: (value: number) => void;
  onSubmit: () => void;
  pending: boolean;
  locked?: boolean;
  error?: string;
}): React.ReactNode {
  return (
    <div className="ph-no-capture ph-block-email space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="mb-1.5 block text-sm font-medium">{messages.interval}</span>
          <Select
            value={interval}
            onChange={(value) => onIntervalChange(value as BillingInterval)}
            options={[
              { value: "monthly", label: messages.monthly },
              { value: "yearly", label: messages.yearly },
            ]}
            ariaLabel={messages.interval}
            contentClassName="ph-no-capture ph-block-email"
            disabled={locked}
          />
        </div>
        <Field label={messages.totalSeats} htmlFor="billing-existing-total-seats">
          <Input
            id="billing-existing-total-seats"
            aria-label={messages.totalSeats}
            type="number"
            min={1}
            max={10000}
            step={1}
            value={totalSeats}
            disabled={locked}
            onChange={(event) => onTotalSeatsChange(Number(event.target.value))}
          />
        </Field>
      </div>
      <p className="text-sm text-muted-foreground">{messages.pricingAtCheckout}</p>
      {error !== undefined ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="button" onClick={onSubmit} disabled={pending}>
        {pending ? messages.startingSubscription : messages.startSubscription}
      </Button>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
