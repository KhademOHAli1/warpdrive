import type { ManufacturingRelease, ReleaseFixtureState } from "../contracts";
import type {
  ChangeRelease,
  EngineeringChange,
  EngineeringChangeAccess,
  EngineeringChangeCommand,
  EngineeringChangeError,
  EngineeringChangeEvent,
  EngineeringChangeResult,
  OldReleasePosition,
} from "./contracts";
import { buildFixtureChangeReview } from "./reviewFixture";

export type EngineeringFixtureActor = {
  id: string;
  name: string;
  canView: boolean;
  canPropose: boolean;
  canDecide: boolean;
  visibleSites: readonly string[];
  dispositionSites: readonly string[];
};

type FixtureProduct = { sku: string; state: ReleaseFixtureState };
type FixturePosition = Omit<OldReleasePosition, "canDispose"> & { siteId: string };
type ChangeLedger = { changes: EngineeringChange[]; stock: FixturePosition[] };
type Receipt = { input: string };
type Options = {
  product: (itemId: string) => FixtureProduct | undefined;
  sealPackage: (itemId: string, candidate: ManufacturingRelease, approvedAt: string) => boolean;
  now?: () => number;
};

const empty: ChangeLedger = { changes: [], stock: [] };
const releaseId = (itemId: string, revision: string) => `${itemId}:${revision}`;
const fail = (error: EngineeringChangeError) => ({ ok: false as const, error });
const succeed = <T>(value: T): EngineeringChangeResult<T> => ({ ok: true, value });
const iso = (time: number) => new Date(time).toISOString();
const validReason = (text: string) => text.trim().length > 0 && text.trim().length <= 400;

function projectRelease(itemId: string, release: ManufacturingRelease): ChangeRelease {
  return {
    id: releaseId(itemId, release.revision),
    revision: release.revision,
    status: release.status,
  };
}

function controlInEffect(change: EngineeringChange, now: number) {
  return change.status === "approved" && Date.parse(change.effectiveAt) <= now;
}

function effectiveRevision(ledger: ChangeLedger, fallback: string | null, now: number) {
  return (
    ledger.changes.filter((change) => controlInEffect(change, now)).at(-1)?.review.candidate
      .revision ?? fallback
  );
}

function allows(actor: EngineeringFixtureActor, command: EngineeringChangeCommand) {
  switch (command.type) {
    case "submit":
    case "withdraw":
      return actor.canPropose;
    case "approve":
    case "return":
      return actor.canDecide;
    case "disposition":
      return actor.dispositionSites.length > 0;
  }
}

function history(
  type: EngineeringChangeEvent["type"],
  actor: EngineeringFixtureActor,
  now: number,
  note: string | null = null,
): EngineeringChangeEvent {
  return { id: crypto.randomUUID(), type, at: iso(now), actor: actor.name, note };
}

function seedPositions(change: EngineeringChange, sku: string): FixturePosition[] {
  if (sku !== "IO-24-DIN" || change.review.base.revision !== "A") return [];
  const facts = {
    changeId: change.id,
    version: "1",
    revision: change.review.base.revision,
    quantity: "1",
    history: [],
  };
  return [
    {
      ...facts,
      id: `${change.id}-BERLIN-005`,
      siteId: "berlin",
      site: "Berlin assembly",
      location: "Finished goods A-01",
      lot: "IO-A-2401",
      serial: "IO-A-005",
      reserved: "0",
      status: "available",
    },
    {
      ...facts,
      id: `${change.id}-BERLIN-006`,
      siteId: "berlin",
      site: "Berlin assembly",
      location: "Finished goods A-01",
      lot: "IO-A-2401",
      serial: "IO-A-006",
      reserved: "1",
      status: "available",
    },
    {
      ...facts,
      id: `${change.id}-DRESDEN-008`,
      siteId: "dresden",
      site: "Dresden service",
      location: "Service stores B-02",
      lot: "IO-A-2402",
      serial: "IO-A-008",
      reserved: "0",
      status: "unavailable",
    },
  ];
}

function changeForCommand(ledger: ChangeLedger, changeId: string, expectedVersion?: number) {
  const change = ledger.changes.find(({ id }) => id === changeId);
  return change !== undefined &&
    (expectedVersion === undefined || change.version === expectedVersion)
    ? change
    : undefined;
}

function writeChange(ledger: ChangeLedger, change: EngineeringChange): ChangeLedger {
  if (!ledger.changes.some(({ id }) => id === change.id))
    return { ...ledger, changes: [...ledger.changes, change] };
  return {
    ...ledger,
    changes: ledger.changes.map((entry) => (entry.id === change.id ? change : entry)),
  };
}

function allowedDisposition(
  actor: EngineeringFixtureActor,
  position: FixturePosition,
  change: EngineeringChange | undefined,
  now: number,
) {
  return (
    change !== undefined &&
    controlInEffect(change, now) &&
    position.reserved === "0" &&
    position.status !== "unavailable" &&
    actor.visibleSites.includes(position.siteId) &&
    actor.dispositionSites.includes(position.siteId)
  );
}

export function createEngineeringChangeFixture({ product, sealPackage, now = Date.now }: Options) {
  const histories = new Map<string, ChangeLedger>();
  const receipts = new Map<string, Receipt>();
  const ledgerFor = (itemId: string) => histories.get(itemId) ?? empty;

  function readWorkspace(itemId: string, current: FixtureProduct, actor: EngineeringFixtureActor) {
    const ledger = ledgerFor(itemId);
    const time = now();
    const state = current.state;
    const active = effectiveRevision(ledger, state.activeRevision, time);
    const effective = state.releases.find(({ revision }) => revision === active);
    const positions = ledger.stock.flatMap(({ siteId, ...position }) =>
      actor.visibleSites.includes(siteId)
        ? [
            {
              ...position,
              canDispose: allowedDisposition(
                actor,
                { siteId, ...position },
                changeForCommand(ledger, position.changeId),
                time,
              ),
            },
          ]
        : [],
    );
    return {
      itemId,
      sku: current.sku,
      effectiveRelease: effective === undefined ? null : projectRelease(itemId, effective),
      candidates: state.releases
        .filter(({ status }) => status === "draft")
        .map((release) => projectRelease(itemId, release)),
      canPropose: actor.canPropose,
      canDecide: actor.canDecide,
      changes: [...ledger.changes].reverse(),
      stock:
        actor.visibleSites.length === 0
          ? null
          : {
              positions,
              unattributed:
                actor.visibleSites.includes("berlin") &&
                current.sku === "IO-24-DIN" &&
                positions.length > 0,
            },
    };
  }

  function selectedPackage(itemId: string, candidateId: string, current: FixtureProduct) {
    const state = current.state;
    const active = effectiveRevision(ledgerFor(itemId), state.activeRevision, now());
    const base = state.releases.find(
      ({ revision, status }) => revision === active && status === "released",
    );
    const candidate = state.releases.find(
      ({ revision, status }) => releaseId(itemId, revision) === candidateId && status === "draft",
    );
    return base === undefined || candidate === undefined ? null : { base, candidate };
  }

  async function prepareReview(
    itemId: string,
    candidateId: string,
    current: FixtureProduct,
    signal?: AbortSignal,
  ) {
    const selected = selectedPackage(itemId, candidateId, current);
    if (selected === null) return null;
    const review = await buildFixtureChangeReview(
      itemId,
      current.sku,
      selected.base,
      selected.candidate,
      signal,
    );
    return { review, ...selected };
  }

  function disposition(
    ledger: ChangeLedger,
    actor: EngineeringFixtureActor,
    command: Extract<EngineeringChangeCommand, { type: "disposition" }>,
  ) {
    if (!validReason(command.reason)) return fail("invalid");
    const position = ledger.stock.find(
      ({ id, changeId }) => id === command.positionId && changeId === command.changeId,
    );
    const change = changeForCommand(ledger, command.changeId);
    if (position === undefined || !allowedDisposition(actor, position, change, now()))
      return fail("stockUnavailable");
    if (position.version !== command.expectedPositionVersion) return fail("conflict");
    if (command.action === "hold" ? position.status !== "available" : position.status !== "held")
      return fail("stockUnavailable");
    const replacement: FixturePosition = {
      ...position,
      status: command.action === "hold" ? "held" : "available",
      version: String(Number(position.version) + 1),
      history: [
        ...position.history,
        {
          id: crypto.randomUUID(),
          action: command.action,
          at: iso(now()),
          actor: actor.name,
          reason: command.reason.trim(),
        },
      ],
    };
    return succeed({
      ...ledger,
      stock: ledger.stock.map((entry) => (entry.id === position.id ? replacement : entry)),
    });
  }

  type Step = EngineeringChangeResult<{ ledger: ChangeLedger; seal?: ManufacturingRelease }>;

  function submit(
    current: ChangeLedger,
    actor: EngineeringFixtureActor,
    command: Extract<EngineeringChangeCommand, { type: "submit" }>,
    selection: Awaited<ReturnType<typeof prepareReview>>,
  ): Step {
    if (!validReason(command.reason)) return fail("invalid");
    const time = now();
    const effective = Date.parse(command.effectiveAt);
    if (!Number.isFinite(effective) || iso(effective) !== command.effectiveAt || effective <= time)
      return fail("effectiveDate");
    if (
      selection === null ||
      selection.review.base.id !== command.baseReleaseId ||
      selection.review.fingerprint !== command.fingerprint
    )
      return fail("staleReview");
    if (!selection.review.ready) return fail("packageIncomplete");
    const prior =
      command.revise === undefined
        ? undefined
        : changeForCommand(current, command.revise.changeId, command.revise.expectedVersion);
    if (
      command.revise !== undefined &&
      (prior?.status !== "returned" || prior.review.candidate.id !== command.candidateReleaseId)
    )
      return fail("conflict");
    const competing = current.changes.some(
      (row) =>
        row.id !== prior?.id &&
        (row.status === "review" ||
          row.status === "returned" ||
          (row.status === "approved" && !controlInEffect(row, time))),
    );
    if (competing) return fail("conflict");
    const change: EngineeringChange = {
      id: prior?.id ?? crypto.randomUUID(),
      version: (prior?.version ?? 0) + 1,
      status: "review",
      review: selection.review,
      reason: command.reason.trim(),
      effectiveAt: command.effectiveAt,
      history: [...(prior?.history ?? []), history("submitted", actor, time)],
    };
    return succeed({ ledger: writeChange(current, change) });
  }

  function decide(
    current: ChangeLedger,
    actor: EngineeringFixtureActor,
    command: Extract<EngineeringChangeCommand, { type: "approve" | "return" | "withdraw" }>,
    selection: Awaited<ReturnType<typeof prepareReview>>,
    sku: string,
  ): Step {
    const change = changeForCommand(current, command.changeId, command.expectedVersion);
    if (
      change === undefined ||
      (change.status !== "review" && !(change.status === "returned" && command.type === "withdraw"))
    )
      return fail("conflict");
    const time = now();
    const updated = { ...change, version: change.version + 1 };
    if (command.type === "withdraw") {
      return succeed({
        ledger: writeChange(current, {
          ...updated,
          status: "withdrawn",
          history: [...change.history, history("withdrawn", actor, time)],
        }),
      });
    }
    if (command.type === "return") {
      if (!validReason(command.note)) return fail("invalid");
      return succeed({
        ledger: writeChange(current, {
          ...updated,
          status: "returned",
          history: [...change.history, history("returned", actor, time, command.note.trim())],
        }),
      });
    }
    if (
      selection === null ||
      selection.review.fingerprint !== command.fingerprint ||
      change.review.fingerprint !== command.fingerprint
    )
      return fail("staleReview");
    if (!selection.review.ready) return fail("packageIncomplete");
    if (Date.parse(change.effectiveAt) <= time) return fail("effectiveDate");
    const approved: EngineeringChange = {
      ...updated,
      status: "approved",
      history: [...change.history, history("approved", actor, time)],
    };
    const ledger = writeChange(current, approved);
    return succeed({
      ledger: { ...ledger, stock: [...ledger.stock, ...seedPositions(approved, sku)] },
      seal: selection.candidate,
    });
  }

  async function reviewForCommand(command: EngineeringChangeCommand, current: FixtureProduct) {
    const { itemId } = command;
    if (command.type === "submit")
      return prepareReview(itemId, command.candidateReleaseId, current);
    if (command.type !== "approve") return null;
    const change = changeForCommand(ledgerFor(itemId), command.changeId);
    return change === undefined ? null : prepareReview(itemId, change.review.candidate.id, current);
  }

  function applyCommand(
    actor: EngineeringFixtureActor,
    command: EngineeringChangeCommand,
    selection: Awaited<ReturnType<typeof prepareReview>>,
    sku: string,
  ): Step {
    const ledger = ledgerFor(command.itemId);
    if (command.type === "submit") return submit(ledger, actor, command, selection);
    if (command.type !== "disposition") return decide(ledger, actor, command, selection, sku);
    const changed = disposition(ledger, actor, command);
    return changed.ok ? succeed({ ledger: changed.value }) : changed;
  }

  function access(getActor: () => EngineeringFixtureActor): EngineeringChangeAccess {
    return {
      read(itemId, signal) {
        if (signal?.aborted === true)
          return Promise.reject(
            new DOMException("Engineering change read cancelled", "AbortError"),
          );
        const actor = getActor();
        const current = product(itemId);
        if (!actor.canView || current === undefined) return Promise.resolve(fail("unavailable"));
        return Promise.resolve(succeed(readWorkspace(itemId, current, actor)));
      },
      async preview(itemId, candidateReleaseId, signal) {
        signal?.throwIfAborted();
        const initial = getActor();
        const current = product(itemId);
        if (!initial.canView || !initial.canPropose || current === undefined)
          return fail("unavailable");
        const result = await prepareReview(itemId, candidateReleaseId, current, signal);
        const actor = getActor();
        if (actor.id !== initial.id || !actor.canView || !actor.canPropose)
          return fail("unavailable");
        if (product(itemId)?.state !== current.state) return fail("staleReview");
        return result === null ? fail("unavailable") : succeed(result.review);
      },
      async execute(command) {
        const initial = getActor();
        const itemId = command.itemId;
        const current = product(itemId);
        if (!initial.canView || !allows(initial, command) || current === undefined)
          return fail("unavailable");
        const key = `${initial.id}:${command.requestId}`;
        const input = JSON.stringify(command);
        function replay(actor: EngineeringFixtureActor) {
          const prior = receipts.get(key);
          if (prior === undefined) return null;
          const latest = product(itemId);
          return prior.input !== input || latest === undefined
            ? fail("conflict")
            : succeed(readWorkspace(itemId, latest, actor));
        }
        const known = replay(initial);
        if (known !== null) return known;
        const selection = await reviewForCommand(command, current);
        const actor = getActor();
        if (initial.id !== actor.id || !actor.canView || !allows(actor, command))
          return fail("unavailable");
        const afterWait = replay(actor);
        if (afterWait !== null) return afterWait;
        if (product(itemId)?.state !== current.state) return fail("staleReview");
        const result = applyCommand(actor, command, selection, current.sku);
        if (!result.ok) return result;
        if (result.value.seal !== undefined && !sealPackage(itemId, result.value.seal, iso(now())))
          return fail("staleReview");
        histories.set(itemId, result.value.ledger);
        receipts.set(key, { input });
        return succeed(readWorkspace(itemId, product(itemId) ?? current, actor));
      },
    };
  }

  return {
    access,
    effectiveRevision: (itemId: string, fallback: string | null) =>
      effectiveRevision(ledgerFor(itemId), fallback, now()),
    hasChangeControl: (itemId: string) =>
      ledgerFor(itemId).changes.some(({ status }) => status !== "withdrawn"),
  };
}
