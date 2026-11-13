import { z } from "zod";

// Route and credential rotation keep the primary engine's receipt namespace stable.
export const OPERATIONAL_ENGINE_KEY =
  "e13d92fa371d3e1499b6a3394be32075d8b565b80b75437c46b50297572df833";

export const operationalKinds = [
  "delivery.failed",
  "delivery.uncertain",
  "delivery.resolved",
  "feedback.bounce",
  "feedback.complaint",
] as const;
export const operationalReasons = [
  "delivery_rejected",
  "submission_unknown",
  "operator_accepted",
  "operator_rejected",
  "provider_accepted",
  "hard_bounce",
  "soft_bounce",
  "unmatched_bounce",
  "complaint",
  "unmatched_complaint",
] as const;
export type OperationalKind = (typeof operationalKinds)[number];
export type OperationalReason = (typeof operationalReasons)[number];
const reasonsByKind: Record<OperationalKind, readonly OperationalReason[]> = {
  "delivery.failed": ["delivery_rejected"],
  "delivery.uncertain": ["submission_unknown"],
  "delivery.resolved": [
    "operator_accepted",
    "operator_rejected",
    "provider_accepted",
    "delivery_rejected",
  ],
  "feedback.bounce": ["hard_bounce", "soft_bounce", "unmatched_bounce"],
  "feedback.complaint": ["complaint", "unmatched_complaint"],
};
export const operationalEventSchema = z
  .strictObject({
    id: z.uuid().regex(/^[0-9a-f-]+$/),
    kind: z.enum(operationalKinds),
    reason: z.enum(operationalReasons),
    count: z.literal(1),
    occurred_at: z.iso.datetime({ offset: true }),
  })
  .refine((event) => reasonsByKind[event.kind].includes(event.reason), {
    message: "Unsupported operational event reason",
  });
export type OperationalEvent = z.infer<typeof operationalEventSchema>;
export const operationalPageSchema = z
  .strictObject({
    events: z.array(operationalEventSchema).max(100),
    pending: z.boolean(),
  })
  .refine((page) => new Set(page.events.map((event) => event.id)).size === page.events.length, {
    message: "Duplicate operational event identity",
  });

export const readinessReasons = [
  "database_unavailable",
  "database_migration",
  "scheduler_starting",
  "scheduler_stale",
  "relay_unconfigured",
  "relay_unavailable",
  "media_unavailable",
  "media_unchecked",
  "feedback_unconfirmed",
  "service_unreachable",
  "events_unavailable",
] as const;
export type ReadinessReason = (typeof readinessReasons)[number];
export const operationalNoticeSchema = z
  .strictObject({
    category: z.enum(["readiness", ...operationalKinds]),
    reason: z.enum([...operationalReasons, ...readinessReasons, "recovered"]),
    count: z.number().int().min(0).max(100),
  })
  .refine(
    (notice) =>
      notice.category === "readiness"
        ? ([...readinessReasons, "recovered"] as readonly string[]).includes(notice.reason)
        : reasonsByKind[notice.category].includes(notice.reason as OperationalReason),
    {
      message: "Unsupported operational notice reason",
    },
  );
export type OperationalNotice = z.infer<typeof operationalNoticeSchema>;

export function operationalOutcome(notice: OperationalNotice): "failed" | "succeeded" | "unknown" {
  if (
    notice.reason === "recovered" ||
    notice.reason === "provider_accepted" ||
    notice.reason === "operator_accepted"
  )
    return "succeeded";
  if (notice.reason === "submission_unknown" || notice.reason.startsWith("unmatched_"))
    return "unknown";
  return "failed";
}
