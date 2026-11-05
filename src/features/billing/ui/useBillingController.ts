"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { billingMessagesForLocale } from "../messages";
import type { BillingInterval } from "../stripe/schemas";
import type { BillingCommand, BillingOverview, BillingSeatPreview } from "./api";
import { type BillingLists, countryOptions, emptyPage, errorCode, readBillingData } from "./data";
import {
  type BillingDraft,
  billingDraftFromCustomer,
  emptyBillingDraft,
  hasCompleteBillingProfile,
} from "./types";
import { useBillingActions } from "./useBillingActions";

type Props = { enabled: boolean; includedSeats: number; allowedCountries: string[] };
type CheckoutCommand = Extract<BillingCommand, { action: "checkout" }>;
type SeatsCommand = Extract<BillingCommand, { action: "change_seats" }>;

export function useBillingController({ enabled, includedSeats, allowedCountries }: Props) {
  const locale = useLocale();
  const messages = billingMessagesForLocale(locale);
  const countries = countryOptions(allowedCountries, locale);
  const defaultCountry = countries[0]?.value ?? "DE";
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [lists, setLists] = useState<BillingLists>({
    "payment-methods": emptyPage(),
    invoices: emptyPage(),
    receipts: emptyPage(),
  });
  const [draft, setDraft] = useState<BillingDraft>(() => emptyBillingDraft(defaultCountry));
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [seatTarget, setSeatTarget] = useState(Math.max(1, includedSeats));
  const [seatPreview, setSeatPreview] = useState<BillingSeatPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingKind, setLoadingKind] = useState<keyof BillingLists | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [checkoutOperation, setCheckoutOperation] = useState<CheckoutCommand | null>(null);
  const [seatsOperation, setSeatsOperation] = useState<SeatsCommand | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const controller = new AbortController();
    let mounted = true;
    void readBillingData(controller.signal)
      .then(({ overview: nextOverview, lists: nextLists }) => {
        if (!mounted) return;
        setOverview(nextOverview);
        setLists(nextLists);
        if (nextOverview.customer !== null) {
          setDraft(billingDraftFromCustomer(nextOverview.customer, defaultCountry));
        }
        setSeatTarget(nextOverview.subscription?.purchasedSeats ?? Math.max(1, includedSeats));
        setError(null);
      })
      .catch((reason: unknown) => {
        if (mounted && !controller.signal.aborted) setError(errorCode(reason));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [defaultCountry, enabled, includedSeats]);

  function updateDraft<Key extends keyof BillingDraft>(key: Key, value: BillingDraft[Key]): void {
    if (checkoutOperation !== null) return;
    setDraft((current) => ({ ...current, [key]: value }));
    setActionError(null);
  }

  const actions = useBillingActions({
    overview,
    lists,
    draft,
    defaultCountry,
    interval,
    seatTarget,
    seatPreview,
    includedSeats,
    setOverview,
    setLists,
    setSeatTarget,
    setSeatPreview,
    setLoading,
    setLoadingKind,
    setAction,
    setError,
    setActionError,
    checkoutOperation,
    setCheckoutOperation,
    seatsOperation,
    setSeatsOperation,
  });

  const customerDraft =
    overview === null || overview.customer === null
      ? draft
      : billingDraftFromCustomer(overview.customer, defaultCountry);
  const addressReady = hasCompleteBillingProfile(customerDraft);
  return {
    locale,
    messages,
    countries,
    overview,
    customerDraft,
    addressReady,
    lists,
    draft,
    interval,
    setInterval,
    seatTarget,
    seatPreview,
    loading: enabled && loading,
    loadingKind,
    action,
    error,
    actionError,
    checkoutLocked: checkoutOperation !== null,
    seatsLocked: seatsOperation !== null,
    updateDraft,
    ...actions,
  };
}
