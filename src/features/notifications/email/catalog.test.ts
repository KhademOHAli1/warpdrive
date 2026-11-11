import { build } from "esbuild";
import { expect, it } from "vitest";
import { createAppTranslator } from "@/features/i18n/catalog";
import { createNotificationEmailTranslator } from "./catalog";

it.each(["en", "de", "fa"] as const)(
  "preserves the application email namespace's ICU rendering in %s",
  (locale) => {
    const isolated = createNotificationEmailTranslator(locale);
    const application = createAppTranslator(locale, "notifications.email");
    expect(isolated("recipientFallback")).toBe(application("recipientFallback"));
    expect(isolated("activity_reminder.subject", { activitySubject: "Call Acme" })).toBe(
      application("activity_reminder.subject", { activitySubject: "Call Acme" }),
    );
    expect(isolated("deal_email_received.subjectWithTitle", { subject: "Offer ۱۲۳" })).toBe(
      application("deal_email_received.subjectWithTitle", { subject: "Offer ۱۲۳" }),
    );
  },
);

it("bundles production mail rendering without the eager UI catalog or UI message files", async () => {
  const result = await build({
    entryPoints: ["src/features/notifications/email/render.ts"],
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    logLevel: "silent",
  });
  const paths = Object.keys(result.metafile.inputs);
  expect(paths).not.toContain("src/features/i18n/catalog.ts");
  const catalogs = paths.filter((path) => path.includes("/messages/") && path.endsWith(".json"));
  expect(catalogs.sort()).toEqual(
    ["de", "en", "fa"].map(
      (locale) => `src/features/notifications/messages/notificationEmail.${locale}.json`,
    ),
  );
});
