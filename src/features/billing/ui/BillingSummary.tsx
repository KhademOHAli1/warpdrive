"use client";

import type React from "react";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardFooter,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Button } from "@/components/ui/Button";
import type { BillingMessages } from "../messages";
import type { BillingOverview } from "./api";

function statusLabel(messages: BillingMessages, status: string): string {
  if (Object.hasOwn(messages.statuses, status))
    return messages.statuses[status as keyof typeof messages.statuses];
  return status;
}

function dateLabel(timestamp: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(timestamp * 1000);
}

function moneyLabel(amountMinor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    currencyDisplay: "symbol",
  }).format(amountMinor / 100);
}

export function BillingSummary({
  messages,
  locale,
  overview,
  onPortal,
  onContinueCheckout,
  onReconcile,
  reconciling,
}: {
  messages: BillingMessages;
  locale: string;
  overview: BillingOverview;
  onPortal: (intent: "overview" | "payment_methods" | "cancel") => void;
  onContinueCheckout: (url: string) => void;
  onReconcile: () => void;
  reconciling: boolean;
}): React.ReactNode {
  const customer = overview.customer;
  const subscription = overview.subscription;
  const checkoutUrl =
    overview.pendingCheckout?.status === "open" ? overview.pendingCheckout.url : null;
  return (
    <>
      <SettingsCard>
        <SettingsCardHeader title={messages.overview} />
        <SettingsCardBody className="space-y-5">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <SummaryValue label={messages.status}>
              {subscription === null ? "-" : statusLabel(messages, subscription.status)}
            </SummaryValue>
            <SummaryValue label={messages.interval}>
              {subscription === null
                ? "-"
                : subscription.interval === "monthly"
                  ? messages.monthly
                  : messages.yearly}
            </SummaryValue>
            <SummaryValue label={messages.activeUsers}>
              <bdi dir="ltr">{overview.activeUsers}</bdi>
            </SummaryValue>
            <SummaryValue label={messages.includedSeats}>
              <bdi dir="ltr">{overview.includedSeats}</bdi>
            </SummaryValue>
            {subscription !== null ? (
              <>
                <SummaryValue label={messages.purchasedSeats}>
                  <bdi dir="ltr">{subscription.purchasedSeats}</bdi>
                </SummaryValue>
                <SummaryValue label={messages.periodEnds}>
                  <bdi dir="ltr">{dateLabel(subscription.currentPeriodEnd, locale)}</bdi>
                </SummaryValue>
              </>
            ) : null}
          </dl>
          {subscription?.cancelAtPeriodEnd === true ? (
            <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              {messages.cancelAtPeriodEnd}
            </p>
          ) : null}
          {overview.syncState === "needs_review" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">{messages.syncNeedsReview}</p>
              <Button variant="outline" size="sm" onClick={onReconcile} disabled={reconciling}>
                {reconciling ? messages.reconciling : messages.reconcile}
              </Button>
            </div>
          ) : null}
          {checkoutUrl != null ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
              <p className="text-sm text-muted-foreground">{messages.pricingAtCheckout}</p>
              <Button variant="outline" size="sm" onClick={() => onContinueCheckout(checkoutUrl)}>
                {messages.continueCheckout}
              </Button>
            </div>
          ) : null}
        </SettingsCardBody>
        {subscription !== null &&
        !["canceled", "incomplete_expired"].includes(subscription.status) &&
        !subscription.cancelAtPeriodEnd ? (
          <SettingsCardFooter>
            <Button variant="outline" size="sm" onClick={() => onPortal("cancel")}>
              {messages.cancelSubscription}
            </Button>
          </SettingsCardFooter>
        ) : null}
      </SettingsCard>

      {customer !== null ? (
        <SettingsCard className="ph-no-capture ph-block-email">
          <SettingsCardHeader title={messages.profile} description={messages.profileCanonical} />
          <SettingsCardBody>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <SummaryValue label={messages.name}>{customer.name ?? "-"}</SummaryValue>
              <SummaryValue label={messages.email}>
                <bdi dir="ltr">{customer.email ?? "-"}</bdi>
              </SummaryValue>
              <SummaryValue label={messages.country}>
                <bdi dir="ltr">{customer.address?.country ?? "-"}</bdi>
              </SummaryValue>
              <SummaryValue label={messages.currency}>
                <bdi dir="ltr">{overview.currency.toUpperCase()}</bdi>
              </SummaryValue>
            </dl>
            <p className="mt-4 text-sm text-muted-foreground">{messages.paymentMethodsManagedBy}</p>
          </SettingsCardBody>
          <SettingsCardFooter>
            <Button variant="outline" size="sm" onClick={() => onPortal("overview")}>
              {messages.manageOnStripe}
            </Button>
          </SettingsCardFooter>
        </SettingsCard>
      ) : null}
    </>
  );
}

export function SummaryValue({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{children}</dd>
    </div>
  );
}

export { dateLabel, moneyLabel, statusLabel };
