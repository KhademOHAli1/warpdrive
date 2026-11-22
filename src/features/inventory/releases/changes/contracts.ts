import type { ReleaseArtifactKind } from "../contracts";

export type ChangeRelease = { id: string; revision: string; status: "draft" | "released" };
export type ChangeFile = { name: string; sha256: string };
export type ChangeMaterial = {
  quantity: string;
  unit: string | null;
  childRelease: string | null;
  alternatives: string[];
  optional: boolean;
  consumable: boolean;
  inherited: boolean;
  pieces: number | null;
};

export type ChangeReview = {
  base: ChangeRelease;
  candidate: ChangeRelease;
  fingerprint: string;
  ready: boolean;
  design: {
    key: string;
    kind: ReleaseArtifactKind;
    before: ChangeFile | null;
    after: ChangeFile | null;
  }[];
  materials: {
    key: string;
    sku: string;
    before: ChangeMaterial | null;
    after: ChangeMaterial | null;
  }[];
  whereUsed: { key: string; parentSku: string; revision: string; componentSku: string }[];
};

export type EngineeringChangeEvent = {
  id: string;
  type: "submitted" | "returned" | "approved" | "withdrawn";
  at: string;
  actor: string;
  note: string | null;
};

export type EngineeringChange = {
  id: string;
  version: number;
  status: "review" | "returned" | "approved" | "withdrawn";
  review: ChangeReview;
  reason: string;
  effectiveAt: string;
  history: EngineeringChangeEvent[];
};

export type OldReleasePosition = {
  id: string;
  changeId: string;
  version: string;
  revision: string;
  site: string;
  location: string | null;
  lot: string | null;
  serial: string | null;
  quantity: string;
  reserved: string;
  status: "available" | "held" | "unavailable";
  canDispose: boolean;
  history: { id: string; action: "hold" | "release"; at: string; actor: string; reason: string }[];
};

export type EngineeringChangeWorkspace = {
  itemId: string;
  sku: string;
  effectiveRelease: ChangeRelease | null;
  candidates: ChangeRelease[];
  canPropose: boolean;
  canDecide: boolean;
  changes: EngineeringChange[];
  stock: { positions: OldReleasePosition[]; unattributed: boolean } | null;
};

type ExistingChange = { changeId: string; expectedVersion: number };
type SubmitTarget = {
  candidateReleaseId: string;
  baseReleaseId: string;
  fingerprint: string;
  effectiveAt: string;
  reason: string;
};

export type EngineeringChangeCommand = { itemId: string; requestId: string } & (
  | ({ type: "submit"; revise?: ExistingChange } & SubmitTarget)
  | ({ type: "approve"; fingerprint: string } & ExistingChange)
  | ({ type: "return"; note: string } & ExistingChange)
  | ({ type: "withdraw" } & ExistingChange)
  | {
      type: "disposition";
      changeId: string;
      positionId: string;
      expectedPositionVersion: string;
      action: "hold" | "release";
      reason: string;
    }
);

export type EngineeringChangeError =
  | "unavailable"
  | "invalid"
  | "staleReview"
  | "conflict"
  | "packageIncomplete"
  | "effectiveDate"
  | "stockUnavailable"
  | "temporary";

export type EngineeringChangeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: EngineeringChangeError };

export type EngineeringChangeAccess = {
  read: (
    itemId: string,
    signal?: AbortSignal,
  ) => Promise<EngineeringChangeResult<EngineeringChangeWorkspace>>;
  preview: (
    itemId: string,
    candidateReleaseId: string,
    signal?: AbortSignal,
  ) => Promise<EngineeringChangeResult<ChangeReview>>;
  execute: (
    command: EngineeringChangeCommand,
  ) => Promise<EngineeringChangeResult<EngineeringChangeWorkspace>>;
};
