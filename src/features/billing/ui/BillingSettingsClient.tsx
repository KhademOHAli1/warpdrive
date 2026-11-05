"use client";

import type React from "react";
import {
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
} from "@/app/(app)/settings/SettingsSurface";
import { Button } from "@/components/ui/Button";
import type { BillingOverview } from "./api";
import { BillingErrorNotice } from "./BillingErrorNotice";
import { BillingHistory } from "./BillingHistory";
import { BillingProfileForm, BillingStartControls } from "./BillingProfileForm";
import { BillingSummary } from "./BillingSummary";
import { SeatChangeCard } from "./SeatChangeCard";
import { useBillingController } from "./useBillingController";

function canStartSubscription(subscription: BillingOverview["subscription"]): boolean {
  return subscription === null || ["canceled", "incomplete_expired"].includes(subscription.status);
}

function canChangeSubscriptionSeats(subscription: BillingOverview["subscription"]): boolean {
  return subscription?.status === "active" && !subscription.cancelAtPeriodEnd;
}

export function BillingSettingsClient(props: {
  enabled: boolean;
  includedSeats: number;
  allowedCountries: string[];
}): React.ReactNode {
  const controller = useBillingController(props);
  const {
    messages,
    locale,
    overview,
    countries,
    draft,
    interval,
    setInterval,
    seatTarget,
    changeSeatsTarget,
    seatPreview,
    lists,
    loading,
    loadingKind,
    action,
    error,
    actionError,
    checkoutLocked,
    seatsLocked,
  } = controller;
  if (!props.enabled) {
    return (
      <SettingsCard>
        <SettingsCardBody>
          <p className="text-sm text-muted-foreground">{messages.disabled}</p>
        </SettingsCardBody>
      </SettingsCard>
    );
  }
  if (loading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {messages.loading}
      </p>
    );
  if (overview === null)
    return <BillingErrorNotice messages={messages} code={error ?? "network"} />;
  const customer = overview.customer;
  const addressReady = controller.addressReady;
  const canChangeSeats = canChangeSubscriptionSeats(overview.subscription);
  return (
    <div className="ph-no-capture ph-block-email space-y-6">
      {error !== null ? <BillingErrorNotice messages={messages} code={error} /> : null}
      {actionError !== null ? <BillingErrorNotice messages={messages} code={actionError} /> : null}
      {checkoutLocked || seatsLocked ? (
        <p role="status" className="text-sm text-muted-foreground">
          {messages.retrySameAction}
        </p>
      ) : null}
      <BillingSummary
        messages={messages}
        locale={locale}
        overview={overview}
        onPortal={(intent) => void controller.openPortal(intent)}
        onContinueCheckout={controller.continueCheckout}
        onReconcile={() => void controller.reconcile()}
        reconciling={action === "reconcile"}
      />
      {customer === null ? (
        <SettingsCard>
          <SettingsCardHeader title={messages.profile} description={messages.profileDescription} />
          <SettingsCardBody>
            <BillingProfileForm
              messages={messages}
              draft={draft}
              onChange={controller.updateDraft}
              countries={countries}
              interval={interval}
              onIntervalChange={setInterval}
              totalSeats={seatTarget}
              onTotalSeatsChange={changeSeatsTarget}
              onSubmit={(event) => {
                event.preventDefault();
                void controller.submitCheckout();
              }}
              pending={action === "checkout"}
              locked={checkoutLocked}
            />
          </SettingsCardBody>
        </SettingsCard>
      ) : canStartSubscription(overview.subscription) ? (
        <SettingsCard>
          <SettingsCardHeader title={messages.plan} />
          <SettingsCardBody>
            {addressReady ? (
              <BillingStartControls
                messages={messages}
                interval={interval}
                onIntervalChange={setInterval}
                totalSeats={seatTarget}
                onTotalSeatsChange={changeSeatsTarget}
                onSubmit={() => void controller.submitCheckout()}
                pending={action === "checkout"}
                locked={checkoutLocked}
              />
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{messages.completeBillingDetails}</p>
                <Button variant="outline" onClick={() => void controller.openPortal("overview")}>
                  {messages.manageOnStripe}
                </Button>
              </div>
            )}
          </SettingsCardBody>
        </SettingsCard>
      ) : null}
      {canChangeSeats ? (
        <SeatChangeCard
          messages={messages}
          locale={locale}
          overview={overview}
          seatTarget={seatTarget}
          onSeatTargetChange={changeSeatsTarget}
          preview={seatPreview}
          previewing={action === "preview_seats"}
          confirming={action === "change_seats"}
          locked={seatsLocked}
          onPreview={() => void controller.previewSeats()}
          onConfirm={() => void controller.confirmSeats()}
        />
      ) : null}
      {customer !== null ? (
        <BillingHistory
          messages={messages}
          locale={locale}
          defaultPaymentMethodId={customer.defaultPaymentMethodId}
          paymentMethods={lists["payment-methods"]}
          invoices={lists.invoices}
          receipts={lists.receipts}
          loadingKind={loadingKind}
          onLoadMore={(kind) => void controller.loadMore(kind)}
          onDocument={(kind, id) => void controller.openDocument(kind, id)}
          onManagePaymentMethods={() => void controller.openPortal("payment_methods")}
        />
      ) : null}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void controller.reconcile()}
          disabled={action === "reconcile"}
        >
          {action === "reconcile" ? messages.reconciling : messages.reconcile}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void controller.reload()}
          disabled={loading}
        >
          {messages.refresh}
        </Button>
      </div>
    </div>
  );
}
