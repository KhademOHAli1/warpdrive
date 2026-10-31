import { expect, it } from "vitest";
import { filterIntegrations, INTEGRATIONS, type IntegrationId } from "./catalog";

const descriptions = Object.fromEntries(
  INTEGRATIONS.map((item) => [item.id, item.id === "gmail" ? "همگام‌سازی تقویم کاری" : ""]),
) as Record<IntegrationId, string>;

it.each(["همگام سازی", "تقويم كاري"])(
  "matches Persian search across keyboard and spacing variants: %s",
  (query) => {
    expect(filterIntegrations(query, "all", descriptions).map((item) => item.id)).toContain(
      "gmail",
    );
  },
);
