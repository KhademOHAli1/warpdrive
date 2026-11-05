import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { currencyCode, moneyAmount } from "@/features/currencies/currencySchema";
import { isTimeZone } from "@/features/i18n/preferences";

export const ANALYTICS_INPUT_CONTRACT_VERSION = 1;
export const MAX_ANALYTICS_INPUT_EVENTS = 500;
export const ANALYTICS_INPUT_QUALIFICATION = {
  state: "unqualified",
  implemented:
    "Payload validation only; no ingest endpoint, persistence or qualified source adapter.",
  required:
    "Authenticate the producer, verify source authority and correction chains, resolve recorded identities, persist originals and deduplication keys, then reapply viewer permissions to every report, export and cache.",
  identity:
    "Identity fields are producer-scoped source IDs, not authorization claims or verified CRM links. No fuzzy identity merging or contact-to-purchase multiplication is permitted.",
  history:
    "Event IDs belong to the producer namespace. Append corrections with supersedes links; do not silently replace original events. Cross-batch duplicates and source revisions require persistent uniqueness checks.",
  calendar:
    "Civil dates are stored as Gregorian ISO dates. The declared source calendar and timezone provide interpretation; adapters must verify actual period boundaries before reporting.",
  money:
    "Amounts retain original currency and major-unit decimal strings. This contract performs no FX conversion and does not equate orders, purchases, invoices, payments, costs or profit.",
} as const;

const sourceId = z.string().min(1).max(160).regex(/\S/, "A source identifier cannot be blank");
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revision = count.min(1);
const timeZone = z.string().min(1).max(100).refine(isTimeZone, "Invalid IANA time zone");

function instantOrder(from: string, to: string): number | null {
  try {
    return Temporal.Instant.compare(from, to);
  } catch {
    return null;
  }
}

const instant = z
  .string()
  .datetime({ offset: true })
  .refine(
    (value) => instantOrder(value, value) === 0,
    "An explicit offset instant with at most nanosecond precision is required",
  );

export const analyticsSourceIdentity = z.strictObject({
  personId: sourceId.optional(),
  accountId: sourceId.optional(),
  opportunityId: sourceId.optional(),
  purchaseId: sourceId.optional(),
});

export const analyticsOriginalMoney = z.strictObject({
  // The shared storage constraint still applies, but a JSON floating-point amount is rejected.
  amount: moneyAmount.and(z.string()),
  currency: currencyCode,
  unit: z.literal("currency-major"),
});

export const analyticsObservationWindow = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("instants"), from: instant, toExclusive: instant }),
    z.strictObject({
      kind: z.literal("civil-days"),
      from: z.string().date(),
      toExclusive: z.string().date(),
    }),
  ])
  .superRefine((window, ctx) => {
    const order =
      window.kind === "civil-days"
        ? window.from.localeCompare(window.toExclusive)
        : instantOrder(window.from, window.toExclusive);
    if (order !== null && order >= 0) {
      ctx.addIssue({
        code: "custom",
        path: ["toExclusive"],
        message: "An observation window must have a later exclusive end",
      });
    }
  });

export const analyticsSourceProvenance = z
  .strictObject({
    producer: sourceId,
    sourceRecordId: sourceId,
    eventId: sourceId,
    revision,
    capturedAt: instant,
    effectiveAt: instant,
    calendar: z.enum(["gregory", "persian"]),
    storage: z.literal("gregorian-iso8601"),
    timeZone,
    supersedes: z.strictObject({ eventId: sourceId, revision }).optional(),
    correctionReason: z
      .string()
      .min(1)
      .max(500)
      .regex(/\S/, "A correction reason cannot be blank")
      .optional(),
    governance: z
      .strictObject({
        agreementRef: sourceId.optional(),
        consentRef: sourceId.optional(),
        retentionPolicyRef: sourceId.optional(),
      })
      .optional(),
  })
  .superRefine((source, ctx) => {
    if (source.revision === 1 && source.supersedes !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["supersedes"],
        message: "An initial revision cannot supersede an earlier event",
      });
    }
    if (
      source.revision > 1 &&
      (source.supersedes === undefined || source.correctionReason === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["supersedes"],
        message: "A correction requires its superseded event, revision and reason",
      });
    }
    if (
      source.supersedes !== undefined &&
      (source.supersedes.revision >= source.revision ||
        source.supersedes.eventId === source.eventId)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["supersedes"],
        message: "A correction must reference a different event at an earlier revision",
      });
    }
    if (source.supersedes === undefined && source.correctionReason !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["correctionReason"],
        message: "A correction reason requires a supersedes link",
      });
    }
  });

const base = { provenance: analyticsSourceProvenance };
const unit = z.strictObject({ kind: z.enum(["person", "account", "geo"]), sourceId });
const touchpoint = z
  .strictObject({
    ...base,
    kind: z.literal("touchpoint"),
    identity: analyticsSourceIdentity,
    identityState: z.enum(["recorded", "unresolved"]),
    channel: sourceId,
    sourceState: z.enum(["captured", "direct", "unknown", "uncaptured"]),
    campaignId: sourceId.optional(),
    interaction: z.enum(["campaign", "event", "referral", "sales", "other"]),
  })
  .superRefine((event, ctx) => {
    const linked = Object.values(event.identity).some((id) => id !== undefined);
    if (event.identityState === "recorded" && !linked) {
      ctx.addIssue({
        code: "custom",
        path: ["identity"],
        message: "Recorded identity requires an explicit source entity ID",
      });
    }
    if (event.identityState === "unresolved" && linked) {
      ctx.addIssue({
        code: "custom",
        path: ["identity"],
        message: "Unresolved identity cannot claim recorded entity links",
      });
    }
  });
const campaignCost = z.strictObject({
  ...base,
  kind: z.literal("campaign-cost"),
  campaignId: sourceId,
  channel: sourceId,
  window: analyticsObservationWindow,
  originalMoney: analyticsOriginalMoney,
  costBasis: z.enum(["media", "fully-loaded", "other"]),
});
const commerce = z
  .strictObject({
    ...base,
    kind: z.literal("commerce"),
    event: z.enum(["order", "purchase", "refund"]),
    orderId: sourceId,
    identity: analyticsSourceIdentity,
    originalMoney: analyticsOriginalMoney,
    quantity: count,
    quantityUnit: sourceId,
  })
  .superRefine((event, ctx) => {
    if (event.event !== "order" && event.identity.purchaseId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["identity", "purchaseId"],
        message:
          "Purchases and refunds require the recorded purchase ID; refund identity names the original purchase",
      });
    }
  });
const billing = z.strictObject({
  ...base,
  kind: z.literal("billing"),
  event: z.enum(["contract-start", "contract-end", "invoice", "payment", "credit"]),
  contractId: sourceId,
  identity: analyticsSourceIdentity,
  billingBasis: z.enum(["recurring", "one-time"]),
  coverageWindow: analyticsObservationWindow,
  originalMoney: analyticsOriginalMoney,
});
const deliveryCost = z.strictObject({
  ...base,
  kind: z.literal("delivery-cost"),
  identity: analyticsSourceIdentity,
  serviceId: sourceId,
  costBasis: z.enum(["labor", "material", "overhead", "other"]),
  window: analyticsObservationWindow,
  originalMoney: analyticsOriginalMoney,
  quantity: z.number().finite().nonnegative(),
  quantityUnit: z.enum(["hours", "units"]),
});
const assignment = z.strictObject({
  ...base,
  kind: z.literal("experiment-assignment"),
  experimentId: sourceId,
  variantId: sourceId,
  unit,
  assignmentMethod: z.enum(["randomized", "observational", "unknown"]),
});
const exposure = z.strictObject({
  ...base,
  kind: z.literal("experiment-exposure"),
  experimentId: sourceId,
  variantId: sourceId,
  assignmentEventId: sourceId,
  unit,
});
const geoOutcome = z
  .strictObject({
    ...base,
    kind: z.literal("geo-outcome"),
    experimentId: sourceId,
    variantId: sourceId,
    geoId: sourceId,
    window: analyticsObservationWindow,
    countUnit: z.enum(["people", "accounts"]),
    eligibleUnits: count,
    exposedUnits: count,
    convertedUnits: count,
    originalMoney: analyticsOriginalMoney.optional(),
  })
  .superRefine((event, ctx) => {
    for (const field of ["exposedUnits", "convertedUnits"] as const) {
      if (event[field] > event.eligibleUnits) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Distinct observed units cannot exceed the eligible population",
        });
      }
    }
  });
const customerSignal = z.strictObject({
  ...base,
  kind: z.literal("customer-signal"),
  signal: z.enum(["survey", "ticket"]),
  identity: analyticsSourceIdentity,
  categoryId: sourceId,
  state: z.enum(["response", "open", "resolved"]),
});

export const analyticsSourceEvent = z.discriminatedUnion("kind", [
  touchpoint,
  campaignCost,
  commerce,
  billing,
  deliveryCost,
  assignment,
  exposure,
  geoOutcome,
  customerSignal,
]);
export type AnalyticsSourceEvent = z.infer<typeof analyticsSourceEvent>;

function sourceEventKey(producer: string, eventId: string): string {
  return JSON.stringify([producer, eventId]);
}

export const analyticsInputBatch = z
  .strictObject({
    contractVersion: z.literal(ANALYTICS_INPUT_CONTRACT_VERSION),
    batchId: sourceId,
    events: z.array(analyticsSourceEvent).min(1).max(MAX_ANALYTICS_INPUT_EVENTS),
  })
  .superRefine((batch, ctx) => {
    const events = new Map<string, AnalyticsSourceEvent>();
    const revisions = new Set<string>();
    batch.events.forEach((event, index) => {
      const source = event.provenance;
      const key = JSON.stringify([source.producer, source.sourceRecordId, source.revision]);
      const eventKey = sourceEventKey(source.producer, source.eventId);
      if (events.has(eventKey)) {
        ctx.addIssue({
          code: "custom",
          path: ["events", index, "provenance", "eventId"],
          message: "Duplicate batch event ID",
        });
      } else {
        events.set(eventKey, event);
      }
      if (revisions.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["events", index, "provenance", "revision"],
          message: "Duplicate producer/source-record revision",
        });
      }
      revisions.add(key);
    });
    batch.events.forEach((event, index) => {
      const source = event.provenance;
      const previous =
        source.supersedes === undefined
          ? undefined
          : events.get(sourceEventKey(source.producer, source.supersedes.eventId));
      if (
        previous !== undefined &&
        (previous.provenance.producer !== source.producer ||
          previous.provenance.sourceRecordId !== source.sourceRecordId ||
          previous.provenance.revision !== source.supersedes?.revision ||
          previous.kind !== event.kind)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["events", index, "provenance", "supersedes"],
          message:
            "A correction target must have the same producer, source record, event family and declared prior revision",
        });
      }
    });
  });
export type AnalyticsInputBatch = z.infer<typeof analyticsInputBatch>;
