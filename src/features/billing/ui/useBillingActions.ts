import { useEffect, useRef } from "react";
import type { BillingActionContext, CheckoutCommand, SeatsCommand } from "./actionTypes";
import {
  type BillingCheckout,
  billingResponseSchemas,
  getBillingPage,
  navigateToBillingDocument,
  navigateToStripe,
  postBilling,
} from "./api";
import {
  appendPage,
  type BillingLists,
  errorCode,
  readBillingData,
  uncertainBillingOutcome,
} from "./data";
import {
  billingDraftFromCustomer,
  billingProfileFromDraft,
  hasCompleteBillingProfile,
} from "./types";

export type { BillingActionContext } from "./actionTypes";

function randomRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export function useBillingActions(context: BillingActionContext) {
  const activeControllers = useRef(new Set<AbortController>());
  useEffect(
    () => () => {
      for (const controller of activeControllers.current) controller.abort();
    },
    [],
  );
  const {
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
  } = context;

  async function withController<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    activeControllers.current.add(controller);
    try {
      return await work(controller.signal);
    } finally {
      activeControllers.current.delete(controller);
    }
  }

  async function reload(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const next = await withController(readBillingData);
      setOverview(next.overview);
      setLists(next.lists);
      if (checkoutOperation === null && seatsOperation === null && seatPreview === null) {
        setSeatTarget(next.overview.subscription?.purchasedSeats ?? Math.max(1, includedSeats));
      }
    } catch (reason: unknown) {
      setError(errorCode(reason));
    } finally {
      setLoading(false);
    }
  }

  function checkoutCommand(): CheckoutCommand | null {
    if (checkoutOperation !== null) return checkoutOperation;
    const source =
      overview === null || overview.customer === null
        ? draft
        : billingDraftFromCustomer(overview.customer, defaultCountry);
    if (!hasCompleteBillingProfile(source) || !Number.isInteger(seatTarget) || seatTarget < 1)
      return null;
    const command: CheckoutCommand = {
      action: "checkout",
      requestId: randomRequestId(),
      interval,
      totalSeats: seatTarget,
      profile: billingProfileFromDraft(source),
    };
    setCheckoutOperation(command);
    return command;
  }

  async function submitCheckout(): Promise<void> {
    const command = checkoutCommand();
    if (command === null) {
      setActionError("invalid_input");
      return;
    }
    setAction("checkout");
    setActionError(null);
    let checkout: BillingCheckout;
    try {
      checkout = await withController((signal) =>
        postBilling(command, billingResponseSchemas.checkout, signal),
      );
    } catch (reason: unknown) {
      const code = errorCode(reason);
      if (!uncertainBillingOutcome(code)) setCheckoutOperation(null);
      setActionError(code);
      setAction(null);
      return;
    }
    setCheckoutOperation(null);
    setAction(null);
    if (checkout.url !== null) {
      try {
        navigateToStripe(checkout.url);
      } catch (reason: unknown) {
        setActionError(errorCode(reason));
      }
      return;
    }
    await reload();
  }

  async function openPortal(intent: "overview" | "payment_methods" | "cancel"): Promise<void> {
    setAction(`portal:${intent}`);
    setActionError(null);
    try {
      const result = await withController((signal) =>
        postBilling({ action: "portal", intent }, billingResponseSchemas.portal, signal),
      );
      navigateToStripe(result.url);
    } catch (reason: unknown) {
      setActionError(errorCode(reason));
    } finally {
      setAction(null);
    }
  }

  async function previewSeats(): Promise<void> {
    if (seatsOperation !== null || !Number.isInteger(seatTarget) || seatTarget < 1) {
      setActionError("invalid_input");
      return;
    }
    setAction("preview_seats");
    setActionError(null);
    try {
      const preview = await withController((signal) =>
        postBilling(
          { action: "preview_seats", totalSeats: seatTarget },
          billingResponseSchemas.seatPreview,
          signal,
        ),
      );
      setSeatPreview(preview);
    } catch (reason: unknown) {
      setActionError(errorCode(reason));
    } finally {
      setAction(null);
    }
  }

  async function confirmSeats(): Promise<void> {
    const command =
      seatsOperation ??
      (seatPreview === null
        ? null
        : ({
            action: "change_seats",
            requestId: randomRequestId(),
            quote: seatPreview.quote,
          } satisfies SeatsCommand));
    if (command === null) return;
    setSeatsOperation(command);
    setAction("change_seats");
    setActionError(null);
    try {
      await withController((signal) =>
        postBilling(command, billingResponseSchemas.seatChange, signal),
      );
    } catch (reason: unknown) {
      const code = errorCode(reason);
      if (!uncertainBillingOutcome(code)) setSeatsOperation(null);
      setActionError(code);
      setAction(null);
      return;
    }
    setSeatsOperation(null);
    setSeatPreview(null);
    setAction(null);
    await reload();
  }

  async function reconcile(): Promise<void> {
    setAction("reconcile");
    setActionError(null);
    try {
      await withController((signal) =>
        postBilling({ action: "reconcile" }, billingResponseSchemas.reconcile, signal),
      );
      setCheckoutOperation(null);
      setSeatsOperation(null);
      setSeatPreview(null);
      await reload();
    } catch (reason: unknown) {
      setActionError(errorCode(reason));
    } finally {
      setAction(null);
    }
  }

  async function loadMore(kind: keyof BillingLists): Promise<void> {
    const cursor = lists[kind].nextCursor;
    if (cursor === null) return;
    setLoadingKind(kind);
    try {
      if (kind === "invoices") {
        const next = await withController((signal) => getBillingPage("invoices", cursor, signal));
        setLists((current) => ({ ...current, invoices: appendPage(current.invoices, next) }));
      } else if (kind === "receipts") {
        const next = await withController((signal) => getBillingPage("receipts", cursor, signal));
        setLists((current) => ({ ...current, receipts: appendPage(current.receipts, next) }));
      } else {
        const next = await withController((signal) =>
          getBillingPage("payment-methods", cursor, signal),
        );
        setLists((current) => ({
          ...current,
          "payment-methods": appendPage(current["payment-methods"], next),
        }));
      }
    } catch (reason: unknown) {
      setActionError(errorCode(reason));
    } finally {
      setLoadingKind(null);
    }
  }

  async function openDocument(kind: "invoices" | "receipts", id: string): Promise<void> {
    setAction(`document:${id}`);
    setActionError(null);
    try {
      await withController((signal) => navigateToBillingDocument(kind, id, signal));
    } catch (reason: unknown) {
      setActionError(errorCode(reason));
    } finally {
      setAction(null);
    }
  }

  function continueCheckout(url: string): void {
    try {
      navigateToStripe(url);
    } catch (reason: unknown) {
      setActionError(errorCode(reason));
    }
  }

  function changeSeatsTarget(value: number): void {
    if (seatsOperation !== null) return;
    setSeatTarget(value);
    setSeatPreview(null);
  }

  return {
    reload,
    submitCheckout,
    openPortal,
    previewSeats,
    confirmSeats,
    reconcile,
    loadMore,
    openDocument,
    continueCheckout,
    changeSeatsTarget,
  };
}
