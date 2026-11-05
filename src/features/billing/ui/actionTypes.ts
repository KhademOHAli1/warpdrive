import type { Dispatch, SetStateAction } from "react";
import type { BillingInterval } from "../stripe/schemas";
import type { BillingCommand, BillingOverview, BillingSeatPreview } from "./api";
import type { BillingLists } from "./data";
import type { BillingDraft } from "./types";

export type CheckoutCommand = Extract<BillingCommand, { action: "checkout" }>;
export type SeatsCommand = Extract<BillingCommand, { action: "change_seats" }>;
type StateSetter<T> = Dispatch<SetStateAction<T>>;

export type BillingActionContext = {
  overview: BillingOverview | null;
  lists: BillingLists;
  draft: BillingDraft;
  defaultCountry: string;
  interval: BillingInterval;
  seatTarget: number;
  seatPreview: BillingSeatPreview | null;
  includedSeats: number;
  setOverview: StateSetter<BillingOverview | null>;
  setLists: StateSetter<BillingLists>;
  setSeatTarget: StateSetter<number>;
  setSeatPreview: StateSetter<BillingSeatPreview | null>;
  setLoading: StateSetter<boolean>;
  setLoadingKind: StateSetter<keyof BillingLists | null>;
  setAction: StateSetter<string | null>;
  setError: StateSetter<string | null>;
  setActionError: StateSetter<string | null>;
  checkoutOperation: CheckoutCommand | null;
  setCheckoutOperation: StateSetter<CheckoutCommand | null>;
  seatsOperation: SeatsCommand | null;
  setSeatsOperation: StateSetter<SeatsCommand | null>;
};
