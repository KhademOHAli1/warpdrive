import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { addCivilDays, instantCivilDate, wallTimeToInstant } from "@/lib/zonedDateTime";
import type { AssetsWorkspace } from "../contracts";
import { assetsFixture } from "../fixtures";
import { emptyKitWorkspace } from "../kits/contracts";
import type { Booking, BookingParticipant, BookingPolicy, BookingWindow } from "./contracts";
import { assetBookingSources } from "./resources";
import type { BookingState } from "./transitions";

type Actor = BookingState["viewer"];
export type FixtureRole = BookingParticipant["role"];
const kitId = "0ec2d593-a42c-47e5-9829-3b0290931417";
const kitLine = "2c4e589c-9fa0-442f-87a0-64340a3a7512";
const baseActor = { id: "bcbd9eeb-c6df-4d81-968b-8c56282df212", name: "Mara Keller" };
const selfActor = { id: "fc29ecf1-8a24-4e4c-91e2-1057b325a6bc", name: "Elias Weber" };

function facilityPolicy(): BookingPolicy {
  return {
    timeZone: "Europe/Berlin",
    baseApproval: true,
    selfServiceApproval: false,
    minNoticeMinutes: 30,
    maxDurationMinutes: 2_880,
    skipClosedDays: true,
    workingHours: {
      enabled: true,
      weekly: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        hours: weekday <= 5 ? { opensAt: "08:00", closesAt: "17:00" } : null,
      })),
      overrides: [],
    },
  };
}

function withSampleKit(workspace: AssetsWorkspace): AssetsWorkspace {
  const pool = workspace.records.find(({ code }) => code === "FERRULE-1");
  if (pool?.tracking !== "consumable_pool")
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing demo ferrules");
  const bin = pool.balances[0];
  if (bin === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing demo ferrule bin");
  return {
    ...workspace,
    records: workspace.records.map((asset) =>
      asset.id === pool.id
        ? { ...pool, balances: [{ ...bin, quantity: bin.quantity - 3 }] }
        : asset,
    ),
    kits: {
      ...emptyKitWorkspace(),
      records: [
        {
          id: kitId,
          siteId: pool.siteId,
          code: "WIRE-KIT",
          name: "Control cabinet wiring kit",
          locationId: bin.locationId,
          version: 1,
          definitionVersion: 1,
          lines: [
            {
              id: kitLine,
              mode: "consumable_pool",
              assetId: pool.id,
              modelId: null,
              sourceLocationId: bin.locationId,
              packedQuantity: 3,
              quantity: 3,
            },
          ],
        },
      ],
    },
  };
}

function demoWindow(now: string, offset: number): BookingWindow {
  const timeZone = "Europe/Berlin";
  let date = addCivilDays(instantCivilDate(now, timeZone), offset);
  for (let following = 0; following < 3; following++) {
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    if (day !== 0 && day !== 6) break;
    date = addCivilDays(date, 1);
  }
  return {
    startAt: wallTimeToInstant(date, "09:00", timeZone).iso,
    endAt: wallTimeToInstant(date, "11:00", timeZone).iso,
  };
}

function featuredBooking(state: BookingState, requester: Actor, now: string): Booking {
  const timeZone = "Europe/Berlin";
  const seededAt = wallTimeToInstant(instantCivilDate(now, timeZone), "00:00", timeZone).iso;
  const resource = state.resources.find(({ code }) => code === "METER-101");
  if (resource === undefined) throw new AppError(ERROR_IDS.DB_INVARIANT, "Missing demo meter");
  const {
    siteId,
    kind,
    resourceId,
    locationId,
    name,
    code,
    bin,
    serial,
    contents,
    kitDefinitionVersion,
  } = resource;
  return {
    id: "265e02cf-1208-480a-88a4-5931477f5273",
    siteId,
    requesterId: requester.id,
    requesterName: requester.name,
    requesterRole: "base",
    title: "Bench meter for control cabinet verification",
    description: null,
    window: demoWindow(now, 2),
    status: "pending",
    archived: false,
    updatedAt: seededAt,
    version: 2,
    lines: [
      {
        kind,
        resourceId,
        locationId,
        name,
        code,
        bin,
        serial,
        contents,
        kitDefinitionVersion,
        quantity: 1,
      },
    ],
    history: [
      { version: 2, at: seededAt, actor: requester.name, kind: "submitted", reason: null },
      { version: 1, at: seededAt, actor: requester.name, kind: "created", reason: null },
    ],
  };
}

export function createBookingFixture(actor: Actor, admin: boolean, now: string): BookingState {
  const base = admin ? baseActor : actor;
  const assets = withSampleKit(assetsFixture(true));
  const state: BookingState = {
    ...assetBookingSources(assets),
    viewer: actor,
    sites: assets.sites.map(({ id, code, name }) => ({
      id,
      code,
      name,
      role: admin ? "manager" : "base",
      canConfigure: admin,
      policyVersion: 1,
      policy: facilityPolicy(),
      participants: [
        { ...base, role: "base" },
        { ...selfActor, role: "self_service" },
      ],
    })),
    bookings: [],
    maintenance: [],
  };
  return { ...state, bookings: [featuredBooking(state, base, now)] };
}

export function fixtureBookingScope(
  state: BookingState,
  principal: Actor,
  role: FixtureRole,
): BookingState {
  return {
    ...state,
    viewer: role === "manager" ? principal : role === "base" ? baseActor : selfActor,
    sites: state.sites.map((site) => ({ ...site, role, canConfigure: role === "manager" })),
  };
}
