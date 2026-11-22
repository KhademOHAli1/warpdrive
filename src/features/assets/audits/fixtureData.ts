import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { AssetsWorkspace } from "../contracts";
import { emptyCustodyWorkspace } from "../custody/contracts";
import { assetsFixture } from "../fixtures";
import { emptyKitWorkspace } from "../kits/contracts";
import type { EquipmentAuditScope } from "./contracts";

const participants = {
  mara: { id: "bcbd9eeb-c6df-4d81-968b-8c56282df212", name: "Mara Keller" },
  elias: { id: "fc29ecf1-8a24-4e4c-91e2-1057b325a6bc", name: "Elias Weber" },
  unassigned: { id: "e2a3e963-4b87-49ca-bfa6-29c615921013", name: "Nora Weiss" },
} as const;

export const auditFixtureParticipants = participants;
export const auditDraftFixtureId = "4936a1c4-c439-4fa8-817e-79b04281be31";
export type AuditFixtureRole = "manager" | keyof typeof participants;

function withDemoPlacements(assets: AssetsWorkspace): AssetsWorkspace {
  const ferrules = assets.records.find(({ code }) => code === "FERRULE-1");
  const meter = assets.records.find(({ code }) => code === "METER-101");
  const bin = assets.locations.find(({ code }) => code === "A-01");
  if (
    ferrules?.tracking !== "consumable_pool" ||
    meter?.tracking !== "individual" ||
    bin === undefined
  ) {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing physical audit demo equipment");
  }
  const id = "a1ec3a28-cc61-4b9b-b9a4-4094b99d9b6a";
  const custodianId = "cf8196d7-648f-4367-989e-edf5d00ad201";
  return {
    ...assets,
    records: [
      ...assets.records.map((row) =>
        row.id === ferrules.id && row.tracking === "consumable_pool"
          ? {
              ...row,
              balances: row.balances.map((balance) =>
                balance.locationId === bin.id
                  ? { ...balance, quantity: balance.quantity - 3 }
                  : balance,
              ),
            }
          : row,
      ),
      {
        ...meter,
        id,
        code: "THERMAL-201",
        name: "Thermal camera",
        serial: "THERMAL-201-0001",
        modelId: null,
        tags: ["Field service"],
        events: [],
      },
    ],
    kits: {
      ...emptyKitWorkspace(),
      records: [
        {
          id: "44266b90-15e3-4257-9c08-4aff8b38aa19",
          siteId: bin.siteId,
          code: "CAL-KIT",
          name: "Calibration instrument kit",
          locationId: bin.id,
          version: 1,
          definitionVersion: 1,
          lines: [
            {
              id: "d4d9d572-25b0-416b-91a1-cacb08bf387b",
              mode: "consumable_pool",
              assetId: ferrules.id,
              modelId: null,
              sourceLocationId: bin.id,
              packedQuantity: 3,
              quantity: 3,
            },
          ],
        },
      ],
    },
    custody: {
      ...emptyCustodyWorkspace(),
      custodians: [
        {
          id: custodianId,
          siteId: bin.siteId,
          kind: "non_login",
          name: participants.elias.name,
          staffId: null,
          active: true,
          version: 1,
        },
      ],
      holdings: [
        {
          id: "c8615e96-1e8e-41af-b541-955320bb1308",
          siteId: bin.siteId,
          assetId: id,
          custodianId,
          custodianName: participants.elias.name,
          sourceLocationId: bin.id,
          locationId: bin.id,
          quantity: 1,
          condition: "good",
          assignedAt: "2026-11-19T10:00:00.000Z",
        },
      ],
    },
  };
}

export function auditFixtureData() {
  const assets = withDemoPlacements(assetsFixture(true));
  const works = assets.sites.find(({ code }) => code === "WORKS");
  if (works === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing audit demo site");
  const scope: EquipmentAuditScope = {
    locationIds: [],
    includeChildren: true,
    assetIds: [],
    kitIds: [],
    categoryIds: [],
    tag: "Test bench",
    includeCustody: false,
  };
  return {
    assets,
    siteId: works.id,
    roster: { [works.id]: Object.values(participants) },
    scope,
  };
}

export function changeLiveAuditDemoEquipment(assets: AssetsWorkspace): AssetsWorkspace {
  const receiving = assets.locations.find(({ code }) => code === "RECEIVING");
  const bin = assets.locations.find(({ code }) => code === "A-01");
  if (receiving === undefined || bin === undefined) {
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing audit demonstration location");
  }
  return {
    ...assets,
    records: assets.records.map((record) => {
      if (record.code === "METER-101" && record.tracking === "individual") {
        return {
          ...record,
          name: "Bench meter after relocation",
          locationId: receiving.id,
          version: record.version + 1,
        };
      }
      if (record.code === "LEAD-SET" && record.tracking === "returnable_pool") {
        return {
          ...record,
          version: record.version + 1,
          balances: record.balances.map((balance) =>
            balance.locationId === bin.id
              ? { ...balance, quantity: balance.quantity + 5 }
              : balance,
          ),
        };
      }
      return record;
    }),
  };
}
