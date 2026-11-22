import type { BookingDemand, BookingWindow } from "./contracts";

type PoolKind = Extract<BookingDemand["kind"], "returnable_pool" | "consumable_pool">;
type CommitmentState = "pending" | "held" | "maintenance";

export type BookingCapacityInventory = {
  assets: readonly {
    id: string;
    siteId: string;
    modelId: string | null;
    locationId: string | null;
  }[];
  kits: readonly {
    id: string;
    siteId: string;
    locationId: string;
    definitionVersion: number;
  }[];
  pools: readonly {
    id: string;
    siteId: string;
    locationId: string;
    kind: PoolKind;
    quantity: number;
  }[];
};

export type BookingCapacityRequest = {
  siteId: string;
  window: BookingWindow;
  demands: readonly BookingDemand[];
  state?: CommitmentState;
  /** Pinned kit definitions apply to held commitments and a request being amended. */
  kitVersions?: Readonly<Record<string, number>>;
  /** A staggered booking cannot count a serial that it has already issued. */
  excludeModelAssetIds?: readonly string[];
};

export type BookingCapacityCommitment = BookingCapacityRequest & {
  state: CommitmentState;
};

export type BookingCapacityWitness =
  | { kind: "asset" | "model"; resourceId: string; assetIds: string[] }
  | { kind: "kit"; resourceId: string; definitionVersion: number }
  | { kind: PoolKind; resourceId: string; locations: { locationId: string; quantity: number }[] };

export type BookingCapacityResult =
  | { ok: true; witness: BookingCapacityWitness[] }
  | { ok: false; error: "invalid" | "conflict" | "search_limit" };

type Window = { start: number; end: number };
type Claim = {
  siteId: string;
  window: Window;
  demand: BookingDemand;
  kitVersion: number | undefined;
  excludedModelUnits: ReadonlySet<string>;
  maintenance: boolean;
};
type Unit = BookingCapacityInventory["assets"][number] & { reserved: Window[] };
type Kit = BookingCapacityInventory["kits"][number] & { reserved: Window[] };
type Pool = BookingCapacityInventory["pools"][number];
type ModelClaim = { claim: Claim; candidates: Unit[] };
type Witnesses = Map<Claim, BookingCapacityWitness>;
type Inventory = {
  units: Map<string, Unit>;
  kits: Map<string, Kit>;
  pools: Map<string, Pool>;
  models: Map<string, Unit[]>;
};

const maxModelSearchSteps = 25_000;
const maxConnectedModelClaims = 256;

function failure(error: Extract<BookingCapacityResult, { ok: false }>["error"]) {
  return { ok: false, error } as const;
}

function modelKey(siteId: string, id: string) {
  return JSON.stringify([siteId, id]);
}

function poolKey({ siteId, demand }: Claim) {
  return JSON.stringify([siteId, demand.kind, demand.resourceId, demand.locationId]);
}

function append<T>(groups: Map<string, T[]>, key: string, value: T) {
  const group = groups.get(key);
  if (group === undefined) groups.set(key, [value]);
  else group.push(value);
}

function prepareInventory(input: BookingCapacityInventory): Inventory {
  const units = new Map(
    input.assets.map((unit) => [unit.id, { ...unit, reserved: [] as Window[] }]),
  );
  const kits = new Map(input.kits.map((kit) => [kit.id, { ...kit, reserved: [] as Window[] }]));
  const pools = new Map(
    input.pools.map((pool) => [
      JSON.stringify([pool.siteId, pool.kind, pool.id, pool.locationId]),
      pool,
    ]),
  );
  const models = new Map<string, Unit[]>();
  for (const unit of [...units.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (unit.modelId !== null) append(models, modelKey(unit.siteId, unit.modelId), unit);
  }
  return { units, kits, pools, models };
}

function normalizeWindow(window: BookingWindow): Window | null {
  const start = Date.parse(window.startAt);
  const end = Date.parse(window.endAt);
  return Number.isFinite(start) && Number.isFinite(end) && start < end ? { start, end } : null;
}

function validDemand(demand: BookingDemand) {
  const { kind, quantity, locationId } = demand;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) return false;
  if (kind === "asset" || kind === "kit") return quantity === 1;
  if (kind === "returnable_pool" || kind === "consumable_pool") return locationId !== null;
  return true;
}

function claimsFor(input: BookingCapacityRequest, asOf: number) {
  const range = normalizeWindow(input.window);
  if (range === null) return null;
  if (range.end <= asOf) return [];
  const window = { start: Math.max(range.start, asOf), end: range.end };
  const { siteId, demands, kitVersions, state } = input;
  const excludedModelUnits = new Set(input.excludeModelAssetIds);
  if (!demands.every(validDemand)) return null;
  return demands.map(
    (demand): Claim => ({
      siteId,
      window,
      demand,
      kitVersion: demand.kind === "kit" ? kitVersions?.[demand.resourceId] : undefined,
      excludedModelUnits,
      maintenance: state === "maintenance",
    }),
  );
}

function collectClaims(
  commitments: readonly BookingCapacityCommitment[],
  siteId: string | undefined,
  asOf: number,
) {
  const claims: Claim[] = [];
  for (const commitment of commitments) {
    if (siteId !== undefined && commitment.siteId !== siteId) continue;
    const current = claimsFor(commitment, asOf);
    if (current === null) return null;
    claims.push(...current);
  }
  return claims;
}

function overlaps(a: Window, b: Window) {
  return a.start < b.end && b.start < a.end;
}

function isFree(resource: { reserved: Window[] }, window: Window) {
  return !resource.reserved.some((reserved) => overlaps(reserved, window));
}

function matchesPlace(resource: { siteId: string; locationId: string | null }, claim: Claim) {
  return (
    resource.siteId === claim.siteId &&
    (claim.demand.locationId === null || resource.locationId === claim.demand.locationId)
  );
}

function reserveUnit(claim: Claim, units: Inventory["units"], witnesses: Witnesses) {
  const unit = units.get(claim.demand.resourceId);
  if (unit === undefined || !matchesPlace(unit, claim) || !isFree(unit, claim.window)) return false;
  unit.reserved.push(claim.window);
  witnesses.set(claim, { kind: "asset", resourceId: unit.id, assetIds: [unit.id] });
  return true;
}

function reserveKit(claim: Claim, kits: Inventory["kits"], witnesses: Witnesses) {
  const kit = kits.get(claim.demand.resourceId);
  if (kit === undefined || !matchesPlace(kit, claim) || !isFree(kit, claim.window)) return false;
  if (claim.kitVersion !== undefined && kit.definitionVersion !== claim.kitVersion) return false;
  kit.reserved.push(claim.window);
  witnesses.set(claim, {
    kind: "kit",
    resourceId: kit.id,
    definitionVersion: kit.definitionVersion,
  });
  return true;
}

function groupClaims(claims: Claim[], inventory: Inventory, witnesses: Witnesses) {
  const models = new Map<string, Claim[]>();
  const pools = new Map<string, Claim[]>();
  for (const claim of claims) {
    const { siteId, demand } = claim;
    switch (demand.kind) {
      case "asset":
        if (!reserveUnit(claim, inventory.units, witnesses)) return null;
        break;
      case "kit":
        if (!reserveKit(claim, inventory.kits, witnesses)) return null;
        break;
      case "model":
        append(models, modelKey(siteId, demand.resourceId), claim);
        break;
      case "returnable_pool":
      case "consumable_pool":
        append(pools, poolKey(claim), claim);
        break;
    }
  }
  return { models, pools };
}

function peakQuantity(claims: Claim[]) {
  const changes = new Map<number, number>();
  for (const { window, demand } of claims) {
    changes.set(window.start, (changes.get(window.start) ?? 0) + demand.quantity);
    changes.set(window.end, (changes.get(window.end) ?? 0) - demand.quantity);
  }
  let occupied = 0;
  let peak = 0;
  for (const [, delta] of [...changes].sort(([a], [b]) => a - b)) {
    occupied += delta;
    peak = Math.max(peak, occupied);
  }
  return peak;
}

function committedConsumables(claims: Claim[]) {
  const maintenance: Claim[] = [];
  let promised = 0;
  for (const claim of claims) {
    if (claim.maintenance) maintenance.push(claim);
    else promised += claim.demand.quantity;
  }
  return promised + peakQuantity(maintenance);
}

function reservePools(
  groups: Map<string, Claim[]>,
  pools: Inventory["pools"],
  witnesses: Witnesses,
) {
  for (const [key, claims] of groups) {
    const pool = pools.get(key);
    if (pool === undefined) return false;
    const occupied =
      pool.kind === "returnable_pool" ? peakQuantity(claims) : committedConsumables(claims);
    if (occupied > pool.quantity) return false;
    for (const claim of claims) {
      // One exact source bin is required for either pooled tracking method.
      witnesses.set(claim, {
        kind: pool.kind,
        resourceId: pool.id,
        locations: [{ locationId: pool.locationId, quantity: claim.demand.quantity }],
      });
    }
  }
  return true;
}

function* connectedClaims(jobs: ModelClaim[]) {
  let group: ModelClaim[] = [];
  let end = -Infinity;
  const sorted = [...jobs].sort((a, b) => a.claim.window.start - b.claim.window.start);
  for (const job of sorted) {
    if (job.claim.window.start >= end && group.length > 0) {
      yield group;
      group = [];
      end = -Infinity;
    }
    group.push(job);
    end = Math.max(end, job.claim.window.end);
  }
  if (group.length > 0) yield group;
}

function hasSimultaneousCapacity(jobs: ModelClaim[]) {
  const dates = new Set(jobs.map(({ claim }) => claim.window.start));
  for (const start of dates) {
    const active = jobs.filter(
      ({ claim }) => claim.window.start <= start && start < claim.window.end,
    );
    const candidates = new Set(active.flatMap((job) => job.candidates));
    const quantity = active.reduce((sum, { claim }) => sum + claim.demand.quantity, 0);
    if (quantity > candidates.size) return false;
  }
  return true;
}

function chooseNextModelClaim(jobs: ModelClaim[]) {
  let choice: { job: ModelClaim; available: Unit[]; slack: number } | undefined;
  for (const job of jobs) {
    const available = job.candidates.filter((unit) => isFree(unit, job.claim.window));
    const slack = available.length - job.claim.demand.quantity;
    if (slack < 0) return null;
    if (choice === undefined || slack < choice.slack) choice = { job, available, slack };
  }
  return choice ?? null;
}

function* combinations(units: Unit[], quantity: number) {
  const indexes = Array.from({ length: quantity }, (_, index) => index);
  for (let cursor = quantity - 1; cursor >= 0; ) {
    yield indexes.map((index) => units[index]).filter((unit) => unit !== undefined);
    cursor = quantity - 1;
    while (cursor >= 0 && indexes[cursor] === units.length - quantity + cursor) cursor--;
    if (cursor < 0) return;
    indexes[cursor] = (indexes[cursor] ?? 0) + 1;
    for (let next = cursor + 1; next < quantity; next++) {
      indexes[next] = (indexes[next - 1] ?? 0) + 1;
    }
  }
}

type Budget = { steps: number };

function searchModelSchedule(jobs: ModelClaim[], witnesses: Witnesses, budget: Budget): boolean {
  if (jobs.length === 0) return true;
  const choice = chooseNextModelClaim(jobs);
  if (choice === null) return false;
  const { job, available } = choice;
  const { claim } = job;
  const remaining = jobs.filter((entry) => entry !== job);
  for (const picked of combinations(available, claim.demand.quantity)) {
    if (budget.steps === 0) return false;
    budget.steps--;
    for (const unit of picked) unit.reserved.push(claim.window);
    witnesses.set(claim, {
      kind: "model",
      resourceId: claim.demand.resourceId,
      assetIds: picked.map(({ id }) => id),
    });
    if (searchModelSchedule(remaining, witnesses, budget)) return true;
    for (const unit of picked) unit.reserved.pop();
    witnesses.delete(claim);
  }
  return false;
}

function reserveModelComponent(
  component: ModelClaim[],
  witnesses: Witnesses,
  budget: Budget,
): "conflict" | "search_limit" | null {
  if (component.length > maxConnectedModelClaims) return "search_limit";
  if (!hasSimultaneousCapacity(component)) return "conflict";
  if (searchModelSchedule(component, witnesses, budget)) return null;
  return budget.steps === 0 ? "search_limit" : "conflict";
}

function reserveModels(
  groups: Map<string, Claim[]>,
  models: Inventory["models"],
  witnesses: Witnesses,
): "conflict" | "search_limit" | null {
  const budget = { steps: maxModelSearchSteps };
  for (const [key, claims] of groups) {
    const units = models.get(key) ?? [];
    const jobs = claims.map(
      (claim): ModelClaim => ({
        claim,
        // After exact bookings are placed, only keep units free across the entire interval.
        candidates: units.filter(
          (unit) =>
            !claim.excludedModelUnits.has(unit.id) &&
            matchesPlace(unit, claim) &&
            isFree(unit, claim.window),
        ),
      }),
    );
    for (const component of connectedClaims(jobs)) {
      const error = reserveModelComponent(component, witnesses, budget);
      if (error !== null) return error;
    }
  }
  return null;
}

/** Plan remaining capacity or validate held commitments against proposed physical inventory. */
export function planBookingCapacity(
  input: BookingCapacityInventory,
  commitments: readonly BookingCapacityCommitment[],
  { asOf, request }: { asOf: string; request?: BookingCapacityRequest },
): BookingCapacityResult {
  const now = Date.parse(asOf);
  if (!Number.isFinite(now)) return failure("invalid");
  const candidate = request === undefined ? [] : claimsFor(request, now);
  if (candidate === null || (request !== undefined && candidate.length !== request.demands.length))
    return failure("invalid");
  const existing = collectClaims(commitments, request?.siteId, now);
  if (existing === null) return failure("invalid");
  if (existing.length === 0 && candidate.length === 0) return { ok: true, witness: [] };
  const inventory = prepareInventory(input);
  const witnesses: Witnesses = new Map();
  const grouped = groupClaims([...existing, ...candidate], inventory, witnesses);
  if (grouped === null || !reservePools(grouped.pools, inventory.pools, witnesses))
    return failure("conflict");
  const modelError = reserveModels(grouped.models, inventory.models, witnesses);
  if (modelError !== null) return failure(modelError);

  const witness: BookingCapacityWitness[] = [];
  for (const claim of candidate) {
    const allocation = witnesses.get(claim);
    if (allocation === undefined) return failure("conflict");
    witness.push(allocation);
  }
  return { ok: true, witness };
}
