import { describe, expect, it } from "vitest";
import type { ApprovedBomLine } from "../releases/schema";
import type { BomPart } from "./contracts";
import type { BomGraph } from "./graph";
import { compareBoms, planBom } from "./planning";
import type { BomPartRecord } from "./reads";

type LineSpec = NonNullable<ApprovedBomLine["spec"]>;

function part(id: string, unit: BomPart["unit"] = "each"): BomPart {
  return { id, code: id, sku: id, name: id, revision: "1", unit };
}

function line(item: BomPart, quantity: number, options: Partial<LineSpec> = {}): ApprovedBomLine {
  return {
    itemId: item.id,
    sku: item.sku,
    name: item.name,
    quantity,
    spec: {
      enteredQuantity: String(quantity),
      enteredUnit: item.unit,
      stockUnit: item.unit,
      childReleaseId: null,
      alternatives: [],
      optional: false,
      consumable: false,
      inherited: false,
      pieces: null,
      ...options,
    },
  };
}

function fixture(): BomGraph {
  const root = part("controller");
  const io = part("io");
  const logic = part("logic");
  const pcba = part("pcba");
  const common = part("common-operations");
  const copper = part("primary-copper", "mm");
  const alternate = part("alternate-copper", "cm");
  const flux = part("flux", "mg");
  const baseIds = [root, io, logic, pcba, common];
  const parts = new Map<string, BomPartRecord>(
    [...baseIds, copper, alternate, flux].map((item) => [
      item.id,
      { part: item, kind: baseIds.includes(item) ? "product" : "component", stockable: true },
    ]),
  );
  const released = (item: BomPart, bom: ApprovedBomLine[]) => ({
    release: { id: `${item.id}:A`, part: item, revision: "A", checksum: null },
    bom,
  });
  const assembly = released(pcba, [
    line(copper, 1200, {
      enteredQuantity: "1.2",
      enteredUnit: "m",
      pieces: 3,
      optional: true,
      alternatives: [
        {
          itemId: alternate.id,
          sku: alternate.sku,
          name: alternate.name,
          stockUnit: "cm",
          quantity: 120,
        },
      ],
    }),
  ]);
  const controller = released(root, [
    line(io, 2, { childReleaseId: "io:A" }),
    line(logic, 1, { childReleaseId: "logic:A" }),
    line(common, 1, { childReleaseId: "common-operations:A", inherited: true }),
  ]);
  const nodes = [
    controller,
    released(io, [line(pcba, 1, { childReleaseId: assembly.release.id })]),
    released(logic, [line(pcba, 2, { childReleaseId: assembly.release.id })]),
    assembly,
    released(common, [line(flux, 250, { consumable: true })]),
  ];
  return { root: controller, ordered: nodes, parts };
}

describe("released BOM planning", () => {
  it("aggregates a shared release before multiplying pieces and netting the chosen leaf once", () => {
    const graph = fixture();
    const availability = new Map([
      ["pcba", 16],
      ["alternate-copper", 500],
      ["flux", 40],
    ]);
    const optional = planBom(graph, 2, [], availability);
    expect(optional.requirements.map(({ part }) => part.id)).not.toContain("primary-copper");
    const plan = planBom(
      graph,
      2,
      [
        {
          releaseId: "pcba:A",
          itemId: "primary-copper",
          substituteItemId: "alternate-copper",
          include: true,
        },
      ],
      availability,
    );
    const demands = new Map(plan.requirements.map((demand) => [demand.part.id, demand]));
    expect(demands.get("pcba")).toMatchObject({
      releaseId: "pcba:A",
      required: 8,
      available: 0,
      genericAssemblyAvailable: 16,
      shortage: 8,
    });
    expect(demands.get("alternate-copper")).toMatchObject({
      required: 960,
      available: 500,
      shortage: 460,
    });
    expect(demands.get("flux")).toMatchObject({
      required: 500,
      available: 0,
      shortage: 0,
      consumable: true,
    });
    expect(demands.has("common-operations")).toBe(false);
    expect(plan.edges.find(({ releaseId }) => releaseId === "pcba:A")).toMatchObject({
      enteredQuantity: "1.2",
      enteredUnit: "m",
      chosenItemId: "alternate-copper",
      requiredPieces: 24,
    });
  });

  it("rejects unknown choices, overflows and catalog units which disagree with the selected pin", () => {
    const graph = fixture();
    const accepted = { releaseId: "pcba:A", itemId: "primary-copper", include: true };
    const noStock = new Map<string, number>();
    expect(() => planBom(graph, 1, [accepted, accepted], noStock)).toThrow("invalid");
    expect(() => planBom(graph, 1, [{ ...accepted, substituteItemId: "flux" }], noStock)).toThrow(
      "invalid",
    );
    expect(() => planBom(graph, 1_000_000, [accepted], noStock)).toThrow("limit");

    const primary = graph.parts.get("primary-copper");
    if (primary === undefined) throw new TypeError("Missing test part");
    const changed = new Map(graph.parts);
    changed.set(primary.part.id, { ...primary, part: { ...primary.part, unit: "m" } });
    expect(() => planBom({ ...graph, parts: changed }, 1, [accepted], noStock)).toThrow(
      "unitChanged",
    );
  });

  it("compares the sealed child pins and describes the baseline release graph", () => {
    const before = fixture();
    const afterNode = {
      release: { ...before.root.release, id: "controller:B", revision: "B" },
      bom: before.root.bom.map((entry) =>
        entry.itemId === "io" && entry.spec !== undefined
          ? { ...entry, spec: { ...entry.spec, childReleaseId: "io:B" } }
          : entry,
      ),
    };
    const after = { ...before, root: afterNode };
    const comparison = compareBoms(before, after);
    expect(comparison.subassemblies.map(({ id }) => id)).toContain("io:A");
    expect(comparison.changes).toHaveLength(1);
    expect(comparison.changes[0]).toMatchObject({
      item: { id: "io" },
      before: { childReleaseId: "io:A" },
      after: { childReleaseId: "io:B" },
    });
  });
});
