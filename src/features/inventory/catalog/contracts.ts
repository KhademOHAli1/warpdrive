import { z } from "zod";

const units = {
  each: ["count", 1],
  um: ["length", 0.000001],
  mm: ["length", 0.001],
  cm: ["length", 0.01],
  m: ["length", 1],
  mg: ["mass", 0.000001],
  g: ["mass", 0.001],
  kg: ["mass", 1],
  mV: ["voltage", 0.001],
  V: ["voltage", 1],
  kV: ["voltage", 1000],
  mA: ["current", 0.001],
  A: ["current", 1],
  Hz: ["frequency", 1],
  kHz: ["frequency", 1000],
  MHz: ["frequency", 1000000],
  ohm: ["resistance", 1],
  kohm: ["resistance", 1000],
  Mohm: ["resistance", 1000000],
} as const;

export type CatalogUnit = keyof typeof units;
export const catalogUnits = Object.keys(units) as CatalogUnit[];

export function catalogUnitDimension(unit: CatalogUnit) {
  return units[unit][0];
}

export function compatibleCatalogUnits(unit: CatalogUnit) {
  return catalogUnits.filter(
    (candidate) => catalogUnitDimension(candidate) === catalogUnitDimension(unit),
  );
}

export function convertCatalogUnits(value: number, from: CatalogUnit, to: CatalogUnit) {
  if (catalogUnitDimension(from) !== catalogUnitDimension(to)) return null;
  return Number(((value * units[from][1]) / units[to][1]).toPrecision(12));
}

const unit = z.enum(catalogUnits);
const id = z.uuid().toLowerCase();
const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_.-]{0,39}$/);
const cleanText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !value.includes("\0"));
const kind = z.enum(["component", "product"]);
const version = z.number().int().nonnegative().max(2147483646);
const boundedName = cleanText(120).pipe(z.string().min(1));
const parameterKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_-]{0,39}$/);

const parameterDefinition = z.strictObject({
  key: parameterKey,
  label: cleanText(100).pipe(z.string().min(1)),
  kind: z.enum(["text", "number", "boolean"]),
  unit: unit.nullable(),
});
const parameterValue = z.strictObject({
  key: parameterKey,
  value: z.union([z.number().min(-1e12).max(1e12), z.boolean(), cleanText(256)]),
  unit: unit.nullable(),
});
const flags = z.strictObject({
  assembly: z.boolean(),
  component: z.boolean(),
  purchasable: z.boolean(),
  salable: z.boolean(),
  testable: z.boolean(),
  trackable: z.boolean(),
});
const profile = z.strictObject({
  version,
  categoryId: id.nullable(),
  stateId: id.nullable(),
  templateItemId: id.nullable(),
  supersedesItemId: id.nullable(),
  relatedItemIds: z.array(id).max(100),
  description: cleanText(2000),
  notes: cleanText(8000),
  tags: z.array(cleanText(40).pipe(z.string().min(1))).max(30),
  unit,
  stockMode: z.enum(["stocked", "virtual", "consumable"]),
  visibility: z.enum(["staff", "admin"]),
  isTemplate: z.boolean(),
  flags,
  values: z.array(parameterValue).max(100),
});
const category = z.strictObject({
  code,
  name: boundedName,
  parentId: id.nullable(),
  defaultUnit: unit.nullable(),
  parameters: z.array(parameterDefinition).max(30),
});
const state = z.strictObject({
  code,
  name: boundedName,
  active: z.boolean(),
  locked: z.boolean(),
});

export type CatalogParameterDefinition = z.infer<typeof parameterDefinition>;
export type CatalogParameterValue = z.infer<typeof parameterValue>;
export type CatalogProfile = z.infer<typeof profile>;
export type CatalogCategory = z.infer<typeof category> & { id: string };
export type CatalogState = z.infer<typeof state> & { id: string };

export const catalogCommand = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("savePart"),
    requestId: id,
    id: id.nullable(),
    code,
    name: boundedName,
    revision: cleanText(20).pipe(z.string().min(1)),
    kind,
    profile: profile.extend({ unit: unit.nullable() }),
  }),
  z.strictObject({
    type: z.literal("setPartState"),
    requestId: id,
    id,
    stateId: id.nullable(),
    version,
  }),
  z.strictObject({
    type: z.literal("saveCategory"),
    requestId: id,
    id: id.nullable(),
    ...category.shape,
  }),
  z.strictObject({
    type: z.literal("saveState"),
    requestId: id,
    id: id.nullable(),
    ...state.shape,
  }),
]);

export type CatalogCommand = z.infer<typeof catalogCommand>;
type WithoutRequest<C> = C extends { requestId: string } ? Omit<C, "requestId"> : never;
export type CatalogIntent = WithoutRequest<CatalogCommand>;

export const catalogQuery = z.strictObject({
  search: cleanText(160).optional(),
  categoryId: id.optional(),
  stateId: id.optional(),
});
export type CatalogQuery = z.infer<typeof catalogQuery>;

export type CatalogPart = {
  id: string;
  familyId: string;
  code: string;
  sku: string;
  name: string;
  revision: string;
  kind: z.infer<typeof kind>;
  onHand: number;
  reserved: number;
  profile: CatalogProfile;
  parameters: CatalogParameterDefinition[];
  whereUsedByIds: string[];
};

export type CatalogWorkspace = {
  parts: CatalogPart[];
  categories: CatalogCategory[];
  states: CatalogState[];
  canManage: boolean;
};

export type CatalogError =
  | "unavailable"
  | "invalid"
  | "conflict"
  | "locked"
  | "cycle"
  | "unitMismatch"
  | "duplicate";

export type CatalogResult =
  | { ok: true; value: CatalogWorkspace; focusId?: string }
  | { ok: false; error: CatalogError };

export function blankCatalogProfile(kind: CatalogPart["kind"]): CatalogProfile {
  return {
    version: 0,
    categoryId: null,
    stateId: null,
    templateItemId: null,
    supersedesItemId: null,
    relatedItemIds: [],
    description: "",
    notes: "",
    tags: [],
    unit: "each",
    stockMode: "stocked",
    visibility: "staff",
    isTemplate: false,
    flags: {
      assembly: kind === "product",
      component: kind === "component",
      purchasable: kind === "component",
      salable: kind === "product",
      testable: false,
      trackable: false,
    },
    values: [],
  };
}
