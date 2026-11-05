"use client";

import type React from "react";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardFooter,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { BillingMessages } from "../messages";
import type { BillingOverview, BillingSeatPreview } from "./api";

export function SeatChangeCard({
  messages,
  locale,
  overview,
  seatTarget,
  onSeatTargetChange,
  preview,
  previewing,
  confirming,
  locked,
  onPreview,
  onConfirm,
  error,
}: {
  messages: BillingMessages;
  locale: string;
  overview: BillingOverview;
  seatTarget: number;
  onSeatTargetChange: (value: number) => void;
  preview: BillingSeatPreview | null;
  previewing: boolean;
  confirming: boolean;
  locked: boolean;
  onPreview: () => void;
  onConfirm: () => void;
  error?: string;
}): React.ReactNode {
  const expiry =
    preview === null
      ? null
      : new Intl.DateTimeFormat(locale, { timeStyle: "short" }).format(preview.expiresAt * 1000);
  return (
    <SettingsCard className="ph-no-capture ph-block-email">
      <SettingsCardHeader
        title={messages.changeSeats}
        description={messages.changeSeatsDescription}
      />
      <SettingsCardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-1.5 block text-sm font-medium">{messages.totalSeats}</span>
            <Input
              aria-label={messages.totalSeats}
              type="number"
              min={overview.activeUsers}
              max={10000}
              step={1}
              value={seatTarget}
              disabled={locked || confirming}
              onChange={(event) => onSeatTargetChange(Number(event.target.value))}
            />
          </div>
          <div className="text-sm text-muted-foreground">
            <p>
              {messages.activeUsers}: <bdi dir="ltr">{overview.activeUsers}</bdi>
            </p>
            <p className="mt-1">
              {messages.purchasedSeats}:{" "}
              <bdi dir="ltr">{overview.subscription?.purchasedSeats ?? "-"}</bdi>
            </p>
          </div>
        </div>
        {preview !== null ? (
          <div className="rounded-md border bg-muted/20 p-4 text-sm">
            <p className="font-medium">{messages.seatQuote}</p>
            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{messages.amountDue}</dt>
                <dd className="mt-1 font-medium">
                  <bdi dir="ltr">{money(preview.amountDue, preview.currency, locale)}</bdi>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{messages.purchasedSeats}</dt>
                <dd className="mt-1 font-medium">
                  <bdi dir="ltr">{preview.purchasedSeats}</bdi>
                </dd>
              </div>
            </dl>
            {expiry !== null ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {messages.quoteExpires.replace("{time}", expiry)}
              </p>
            ) : null}
          </div>
        ) : null}
        {error !== undefined ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </SettingsCardBody>
      <SettingsCardFooter>
        <Button
          variant="outline"
          size="sm"
          onClick={onPreview}
          disabled={locked || previewing || confirming}
        >
          {previewing ? messages.reviewingSeats : messages.previewSeats}
        </Button>
        {preview !== null ? (
          <Button size="sm" onClick={onConfirm} disabled={confirming || previewing}>
            {confirming ? messages.confirmingSeats : messages.confirmSeats}
          </Button>
        ) : null}
      </SettingsCardFooter>
    </SettingsCard>
  );
}

function money(amountMinor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amountMinor / 100);
}
