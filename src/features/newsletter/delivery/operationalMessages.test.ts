import { expect, it } from "vitest";
import { notificationHref } from "@/features/notifications/ui/deepLink";
import type { NotificationFeedItem } from "@/types/notification";
import { operationalReasons, readinessReasons } from "./operationalContracts";
import { operationalNoticeText } from "./operationalMessages";

const item = (payload: Record<string, unknown>) =>
  ({ type: "newsletter_operational", payload }) as NotificationFeedItem;
it("renders only fixed localized diagnostics and safe fixed destinations", () => {
  for (const locale of ["en", "de", "fa"] as const) {
    const pairs = [
      ...readinessReasons.map((reason) => ({ category: "readiness", reason, count: 0 })),
      ...operationalReasons.map((reason) => ({
        category: reason.includes("bounce")
          ? "feedback.bounce"
          : reason.includes("complaint")
            ? "feedback.complaint"
            : reason === "submission_unknown"
              ? "delivery.uncertain"
              : "delivery.resolved",
        reason,
        count: 5,
      })),
    ];
    for (const payload of pairs)
      expect(operationalNoticeText(payload, locale)).not.toContain("notifications.operations");
    expect(
      operationalNoticeText(
        {
          category: "readiness",
          reason: "service_unreachable",
          count: 0,
          email: "secret@example.test",
        },
        locale,
      ),
    ).not.toContain("secret");
  }
  expect(
    operationalNoticeText(
      { category: "delivery.resolved", reason: "provider_accepted", count: 1 },
      "en",
    ),
  ).toContain("handoff to the provider");
  expect(
    operationalNoticeText(
      { category: "feedback.bounce", reason: "unmatched_bounce", count: 1 },
      "en",
    ),
  ).toContain("review");
  expect(
    notificationHref(item({ category: "feedback.bounce", reason: "hard_bounce", count: 1 })),
  ).toBe("/campaigns/subscribers/bounces");
  expect(
    notificationHref(item({ category: "feedback.bounce", reason: "unmatched_bounce", count: 1 })),
  ).toBe("/settings/logs");
  expect(
    notificationHref(
      item({ category: "delivery.resolved", reason: "provider_accepted", count: 1 }),
    ),
  ).toBe("/settings/maintenance");
});
