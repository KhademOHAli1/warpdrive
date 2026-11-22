import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { locationsFixture } from "@/features/locations/fixtures";
import type { AssetCategory, AssetModel, AssetRecord, AssetsWorkspace } from "./contracts";

function siteId(code: string): string {
  const site = locationsFixture.sites.find((entry) => entry.code === code);
  if (site === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing asset demo site");
  return site.id;
}

function locationId(code: string): string {
  const location = locationsFixture.locations.find((entry) => entry.code === code);
  if (location === undefined) {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing asset demo location");
  }
  return location.id;
}

const works = siteId("WORKS");
const service = siteId("FIELD");
const warehouse = locationId("WAREHOUSE");
const incoming = locationId("RECEIVING");
const storage = locationId("A-01");
const toolCrib = locationId("TOOL-CRIB");
const meterCategoryId = "a892480d-1217-4803-9470-5ec06e7fedcc";
const calibrationId = "94bdb6d8-85e8-42de-aff1-e3a495bc5f6a";
const rangeId = "de759496-cfa5-49b8-8612-ec21f1360432";

const meterCategory: AssetCategory = {
  id: meterCategoryId,
  siteId: works,
  name: "Measurement instruments",
  version: 1,
  fields: [
    {
      id: calibrationId,
      label: "Next calibration",
      type: "date",
      options: [],
      required: false,
      defaultValue: null,
    },
    {
      id: rangeId,
      label: "Measurement range",
      type: "choice",
      options: ["0–10 V", "0–30 V", "4–20 mA"],
      required: true,
      defaultValue: "0–30 V",
    },
  ],
};

const meterModel: AssetModel = {
  id: "06f50193-a08c-4f96-82cd-2a130c26b0e3",
  version: 1,
  siteId: works,
  code: "MULTI-87",
  name: "Bench multimeter",
  description: "For voltage and current checks on controller assemblies.",
  categoryId: meterCategoryId,
  tags: ["Test bench", "Calibration"],
  fieldValues: { [rangeId]: "0–30 V" },
};

const base = {
  version: 1,
  description: null,
  categoryId: null,
  tags: [],
  fieldValues: {},
  archivedAt: null,
  events: [],
} satisfies Partial<AssetRecord>;

const archivedAt = "2026-11-13T08:00:00.000Z";
const records: AssetRecord[] = [
  {
    ...base,
    ...meterModel,
    id: "1f07c542-849d-42d9-85c0-56b3ced383fd",
    code: "METER-101",
    tracking: "individual",
    serial: "M87-QA-0101",
    modelId: meterModel.id,
    locationId: storage,
    fieldValues: { ...meterModel.fieldValues, [calibrationId]: "2027-05-12" },
    events: [
      {
        id: "97a86b14-bdf4-41e6-aef9-a855ca271d2e",
        kind: "created",
        actor: "Demo operator",
        at: "2026-11-07T08:00:00.000Z",
        reason: null,
        fromLocationId: null,
        locationId: storage,
        quantity: null,
      },
    ],
  },
  {
    ...base,
    ...meterModel,
    id: "c5224c4c-7786-49c1-8629-bb1f2adae3bd",
    code: "METER-102",
    tracking: "individual",
    serial: "M87-QA-0102",
    modelId: meterModel.id,
    locationId: null,
  },
  {
    ...base,
    id: "58e2dbf2-7198-4e7b-bde1-021bf7c43a16",
    siteId: service,
    code: "LOOP-01",
    name: "Portable loop calibrator",
    tracking: "individual",
    serial: "LOOP-QA-0026",
    modelId: null,
    locationId: toolCrib,
    tags: ["Field service"],
  },
  {
    ...base,
    id: "a6c26035-0334-495b-832f-ab65834fed57",
    siteId: works,
    code: "TOOL-402",
    name: "Torque driver",
    tracking: "individual",
    serial: null,
    modelId: null,
    locationId: warehouse,
    archivedAt,
  },
  {
    ...base,
    id: "a979c5af-1605-45e4-84e9-9667b4a386c2",
    siteId: works,
    code: "LEAD-SET",
    name: "Insulated test leads",
    tags: ["Test bench"],
    tracking: "returnable_pool",
    balances: [
      { locationId: storage, quantity: 12 },
      { locationId: incoming, quantity: 8 },
    ],
  },
  {
    ...base,
    id: "01eb350a-0464-4b48-bbcf-e26d83b45ed7",
    siteId: works,
    code: "FERRULE-1",
    name: "Insulated ferrules",
    tags: ["Wiring"],
    tracking: "consumable_pool",
    balances: [{ locationId: storage, quantity: 100 }],
  },
];

export function assetsFixture(canManage: boolean): AssetsWorkspace {
  return {
    sites: locationsFixture.sites.map(({ id, name, code }) => ({ id, name, code, canManage })),
    locations: locationsFixture.locations.map(({ id, siteId, name, code, parentId, archived }) => ({
      id,
      siteId,
      name,
      code,
      parentId,
      archived,
    })),
    categories: [meterCategory],
    models: [meterModel],
    records,
  };
}

const signalGeneratorModel: AssetModel = {
  ...meterModel,
  id: "8e4eb928-e668-4f55-950f-4be95bf1a5a4",
  code: "SIGNAL-300",
  name: "Bench signal generator",
  description: "Provides test signals for controller assemblies.",
};

const signalGenerators: AssetRecord[] = [
  {
    ...base,
    ...signalGeneratorModel,
    id: "29825baf-1ee0-4a95-be35-e32d3bc36595",
    code: "SIGNAL-10",
    tracking: "individual",
    serial: "SG-10",
    modelId: signalGeneratorModel.id,
    locationId: storage,
  },
  {
    ...base,
    ...signalGeneratorModel,
    id: "3407e40f-a8ca-4b79-ab5a-89c394a22c18",
    code: "SIGNAL-02",
    tracking: "individual",
    serial: "SG-2",
    modelId: signalGeneratorModel.id,
    locationId: storage,
  },
];

export function assetsDiscoveryFixture(canManage: boolean): AssetsWorkspace {
  const workspace = assetsFixture(canManage);
  return {
    ...workspace,
    models: [...workspace.models, signalGeneratorModel],
    records: [...workspace.records, ...signalGenerators],
  };
}
