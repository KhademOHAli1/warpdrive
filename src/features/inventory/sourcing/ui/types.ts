import type {
  SourcingIntent,
  SourcingManufacturer,
  SourcingMoney,
  SourcingOffer,
  SourcingPriceTier,
  SourcingResult,
} from "../contracts";

export type Workspace = Extract<SourcingResult, { ok: true }>["value"];

export type Editor =
  | { type: "manufacturer"; row: SourcingManufacturer | null }
  | { type: "offer"; row: SourcingOffer | null }
  | { type: "tier"; offer: SourcingOffer; tier: SourcingPriceTier | null }
  | { type: "removeTier"; tier: SourcingPriceTier }
  | { type: "override"; cost: SourcingMoney | null }
  | { type: "removeOverride" };

export type DialogProps = {
  pending: boolean;
  error: string | null;
  close: () => void;
  restoreFocus: () => void;
  save: (intent: SourcingIntent) => void;
};
