import type { ApprovedBomLine } from "../releases/schema";
import { inventoryStockLimit } from "../schema";
import type { BomComparison, BomEdge, BomPart, BomPlan, BomPlanningQuery } from "./contracts";
import { failBom } from "./failure";
import type { BomGraph } from "./graph";
import type { BomPartRecord } from "./reads";

type Choice = NonNullable<BomPlanningQuery["choices"]>[number];
type LinePart = BomEdge["primary"];
type Parts = ReadonlyMap<string, BomPartRecord>;
type ComparisonEdge = NonNullable<BomComparison["changes"][number]["before"]>;

function partRecord(parts: Parts, itemId: string) {
  const record = parts.get(itemId);
  if (record === undefined) failBom("unavailable");
  return record;
}

function frozenPart(
  parts: Parts,
  { itemId, sku, name, quantity }: Pick<ApprovedBomLine, "itemId" | "sku" | "name" | "quantity">,
  unit?: BomPart["unit"],
): LinePart {
  const { part } = partRecord(parts, itemId);
  return { ...part, sku, name, quantity, unit: unit ?? part.unit };
}

function boundedQuantity(value: number) {
  if (!Number.isSafeInteger(value) || value < 0 || value > inventoryStockLimit) failBom("limit");
  return value;
}

function choosePart(primary: LinePart, alternatives: LinePart[], selectedId?: string) {
  if (selectedId === undefined || selectedId === primary.id) return primary;
  const selected = alternatives.find(({ id }) => id === selectedId);
  if (selected === undefined) failBom("invalid");
  return selected;
}

function projectLine(
  parts: Parts,
  line: ApprovedBomLine,
  choice?: Choice,
): { projected: ComparisonEdge; chosen: LinePart } {
  const { spec } = line;
  const primary = frozenPart(parts, line, spec?.stockUnit);
  const alternatives = (spec?.alternatives ?? []).map((candidate) =>
    frozenPart(parts, candidate, candidate.stockUnit),
  );
  const chosen = choosePart(primary, alternatives, choice?.substituteItemId);
  const optional = spec?.optional ?? false;
  if (!optional && choice?.include === false) failBom("invalid");
  const included = choice?.include ?? !optional;
  const projected = {
    primary,
    alternatives,
    chosenItemId: chosen.id,
    childReleaseId: spec?.childReleaseId ?? null,
    enteredQuantity: spec?.enteredQuantity ?? String(primary.quantity),
    enteredUnit: spec?.enteredUnit ?? primary.unit,
    optional,
    included,
    inherited: spec?.inherited ?? false,
    consumable: spec?.consumable ?? false,
    piecesPerParent: spec?.pieces ?? null,
  };
  return { projected, chosen };
}

function choiceKey(releaseId: string, itemId: string) {
  return `${releaseId}:${itemId}`;
}

function indexChoices(choices: readonly Choice[]) {
  const indexed = new Map<string, Choice>();
  for (const choice of choices) {
    const key = choiceKey(choice.releaseId, choice.itemId);
    if (indexed.has(key)) failBom("invalid");
    indexed.set(key, choice);
  }
  return indexed;
}

type DemandedLine = {
  part: BomPart;
  releaseId: string | null;
  required: number;
  consumable: boolean;
};

function addDemand(requirements: Map<string, DemandedLine>, line: DemandedLine) {
  const key = `${line.part.id}:${line.releaseId ?? ""}:${line.consumable}`;
  const existing = requirements.get(key);
  const required = boundedQuantity((existing?.required ?? 0) + line.required);
  requirements.set(key, { ...line, required });
}

type ReleaseDemand = { physical: number; inherited: number };
type Demand = {
  byRelease: Map<string, ReleaseDemand>;
  byPart: Map<string, DemandedLine>;
};

function rollUpEdge(
  demand: Demand,
  edge: ComparisonEdge,
  chosen: LinePart,
  parentQuantity: number,
  parts: Parts,
) {
  if (!edge.included || parentQuantity === 0) return;
  const { part } = partRecord(parts, chosen.id);
  if (!edge.inherited && chosen.unit !== part.unit) failBom("unitChanged");
  const required = boundedQuantity(parentQuantity * chosen.quantity);
  if (edge.childReleaseId !== null) {
    const existing = demand.byRelease.get(edge.childReleaseId) ?? { physical: 0, inherited: 0 };
    const kind = edge.inherited ? "inherited" : "physical";
    const updated = boundedQuantity(existing[kind] + required);
    demand.byRelease.set(edge.childReleaseId, { ...existing, [kind]: updated });
  }
  if (!edge.inherited) {
    addDemand(demand.byPart, {
      part,
      releaseId: edge.childReleaseId,
      required,
      consumable: edge.consumable,
    });
  }
}

function netRequirement(
  line: DemandedLine,
  availability: ReadonlyMap<string, number>,
  releaseAvailability?: ReadonlyMap<string, number>,
) {
  const stock = availability.get(line.part.id) ?? 0;
  const leafAvailable = line.consumable ? 0 : stock;
  const available =
    line.releaseId === null ? leafAvailable : (releaseAvailability?.get(line.releaseId) ?? 0);
  return {
    ...line,
    available,
    shortage: line.consumable ? 0 : Math.max(0, line.required - available),
    genericAssemblyAvailable: line.releaseId === null ? 0 : Math.max(0, stock - available),
  };
}

function childBuildQuantity(counts: ReleaseDemand | undefined, available: number) {
  if (counts === undefined) return 0;
  const physicalShortage = Math.max(0, counts.physical - available);
  // An inherited BOM adds material directly to its parent. Stock of the
  // referenced assembly can cover physical demand only.
  return boundedQuantity(physicalShortage + counts.inherited);
}

function requiredPieces(line: ComparisonEdge, parentQuantity: number) {
  if (line.piecesPerParent === null) return null;
  return line.included ? boundedQuantity(line.piecesPerParent * parentQuantity) : 0;
}

export function planBom(
  graph: BomGraph,
  quantity: number,
  requested: readonly Choice[],
  availability: ReadonlyMap<string, number>,
  releaseAvailability?: ReadonlyMap<string, number>,
): BomPlan {
  const choices = indexChoices(requested);
  const root = graph.root.release;
  const demand: Demand = { byRelease: new Map(), byPart: new Map() };
  const edges: BomEdge[] = [];

  // Visit every parent first. A shared release accumulates all physical demand
  // before exact stock offsets it and the remaining build requirements flow down.
  for (const { release, bom } of graph.ordered) {
    const parentQuantity =
      release.id === root.id
        ? quantity
        : childBuildQuantity(
            demand.byRelease.get(release.id),
            releaseAvailability?.get(release.id) ?? 0,
          );
    for (const line of bom) {
      const key = choiceKey(release.id, line.itemId);
      const { projected, chosen } = projectLine(graph.parts, line, choices.get(key));
      choices.delete(key);
      edges.push({
        releaseId: release.id,
        ...projected,
        requiredPieces: requiredPieces(projected, parentQuantity),
      });
      rollUpEdge(demand, projected, chosen, parentQuantity, graph.parts);
    }
  }
  if (choices.size > 0) failBom("invalid");
  return {
    release: root,
    quantity,
    subassemblies: graph.ordered.slice(1).map(({ release }) => release),
    edges,
    requirements: [...demand.byPart.values()].map((line) =>
      netRequirement(line, availability, releaseAvailability),
    ),
  };
}

function comparableEdges(graph: BomGraph): Map<string, ComparisonEdge> {
  return new Map(
    graph.root.bom.map((line) => [line.itemId, projectLine(graph.parts, line).projected]),
  );
}

function lineSignature(edge: ComparisonEdge) {
  const {
    primary,
    alternatives,
    childReleaseId,
    enteredQuantity,
    enteredUnit,
    optional,
    inherited,
    consumable,
    piecesPerParent,
  } = edge;
  return JSON.stringify([
    primary.id,
    primary.quantity,
    primary.unit,
    alternatives.map(({ id, quantity, unit }) => [id, quantity, unit]).sort(),
    childReleaseId,
    enteredQuantity,
    enteredUnit,
    optional,
    inherited,
    consumable,
    piecesPerParent,
  ]);
}

export function compareBoms(before: BomGraph, after: BomGraph): BomComparison {
  const previous = comparableEdges(before);
  const current = comparableEdges(after);
  const ids = new Set([...previous.keys(), ...current.keys()]);
  const changes: BomComparison["changes"] = [];
  for (const id of ids) {
    const earlier = previous.get(id) ?? null;
    const later = current.get(id) ?? null;
    if (earlier !== null && later !== null && lineSignature(earlier) === lineSignature(later))
      continue;
    const item = later?.primary ?? earlier?.primary;
    if (item !== undefined) changes.push({ item, before: earlier, after: later });
  }
  return {
    release: before.root.release,
    subassemblies: before.ordered.slice(1).map(({ release }) => release),
    changes,
  };
}
