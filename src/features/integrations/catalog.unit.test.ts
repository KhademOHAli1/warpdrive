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

it.each([
  ["Google Drive", "google-drive"],
  ["OneDrive", "onedrive"],
  ["Dropbox", "dropbox"],
  ["n8n", "n8n"],
  ["Make", "make"],
  ["Zapier", "zapier"],
  ["GitHub", "github"],
  ["Linear", "linear"],
  ["Jira", "jira"],
  ["Calendly", "calendly"],
  ["Cal.com", "cal-com"],
  ["WhatsApp", "whatsapp"],
  ["Stripe", "stripe"],
])("finds %s as an individual provider", (query, id) => {
  const text = Object.fromEntries(INTEGRATIONS.map((item) => [item.id, ""])) as Record<
    IntegrationId,
    string
  >;
  expect(filterIntegrations(query, "all", text).map((item) => item.id)).toEqual([id]);
});
