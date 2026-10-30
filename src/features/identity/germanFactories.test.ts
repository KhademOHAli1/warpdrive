import { describe, expect, it } from "vitest";
import { activitiesMessagesForLocale } from "@/features/activities/activitiesMessages";
import { authScreensMessagesForLocale } from "@/features/auth/authScreensMessages";
import { emailMessagesForLocale } from "@/features/email/emailMessages";
import {
  canonicalFieldLabel,
  enrichmentMessagesForLocale,
} from "@/features/enrichment/enrichmentMessages";
import { statsMessagesForLocale } from "@/features/stats/statsMessages";
import {
  settingsIdentityError,
  settingsImportError,
  settingsMessagesForLocale,
  settingsPermissionLabel,
} from "./settingsMessages";

describe("German locale factories", () => {
  it("uses German resources in all six factories", () => {
    expect(authScreensMessagesForLocale("de").signInWithGoogle).toBe("Mit Google anmelden");
    expect(activitiesMessagesForLocale("de").addActivity).toBe("Aktivität hinzufügen");
    expect(settingsMessagesForLocale("de").profile).toBe("Persönliche Einstellungen");
    expect(emailMessagesForLocale("de").title).toBe("Posteingang");
    expect(enrichmentMessagesForLocale("de").button.label).toBe("Fehlende Daten ergänzen");
    expect(statsMessagesForLocale("de").underADay).toBe("Weniger als ein Tag");
  });

  it("formats activity plurals and accessible actions without changing the subject", () => {
    const messages = activitiesMessagesForLocale("de");
    const subject = "Demo <Acme> فارسی";
    expect(messages.activityCount(1)).toBe("1 Aktivität");
    expect(messages.activityCount(12)).toBe("12 Aktivitäten");
    expect(messages.selectActivity(subject)).toBe(`${subject} auswählen`);
    expect(messages.markSubjectDone(subject)).toBe(`„${subject}“ als erledigt markieren`);
  });

  it("localizes computed settings labels and known errors without rewriting submitted data", () => {
    const messages = settingsMessagesForLocale("de");
    expect(messages._extra.stageCount(2)).toBe("2 Phasen");
    expect(messages._extra.progressText(1250, 2000, 62.5)).toBe("1.250 von 2.000 (62,5 %)");
    expect(messages._emailSync.connectedAs("Sara+sales@Example.com")).toBe(
      "Verbunden als Sara+sales@Example.com",
    );
    expect(settingsPermissionLabel(messages, "deal.edit_own")).toBe(
      "Eigene Verkaufschancen bearbeiten",
    );
    expect(settingsIdentityError(messages, "cannot deactivate yourself")).toBe(
      "Sie können Ihr eigenes Konto nicht deaktivieren.",
    );
    expect(settingsImportError(messages, "unknown pipeline: Vertrieb Ost", "de")).toBe(
      "Unbekannter Wert für Vertriebspipeline: Vertrieb Ost",
    );
  });

  it("evaluates German email and enrichment functions with original names and numbers", () => {
    const email = emailMessagesForLocale("de");
    expect(email.createLabel("Kundin <Acme>")).toBe("„Kundin <Acme>“ erstellen");
    expect(email.trackingOpened(12)).toBe("12 Mal geöffnet");
    expect(email._extra.record_composer).toBe("Zum Datensatz hinzufügen");
    const enrichment = enrichmentMessagesForLocale("de");
    expect(enrichment.dialog.apply(1)).toBe("1 Feld übernehmen");
    expect(enrichment.dialog.apply(1234)).toBe("1234 Felder übernehmen");
    expect(canonicalFieldLabel("person.title", "Job title", enrichment, "de")).toBe("Position");
    expect(canonicalFieldLabel("custom:region", "Kundenregion", enrichment, "de")).toBe(
      "Kundenregion",
    );
  });

  it("keeps English and Persian factory behavior", () => {
    expect(authScreensMessagesForLocale("en").pageTitle).toBe("Sign in");
    expect(authScreensMessagesForLocale("fa").pageTitle).toBe("ورود");
    expect(activitiesMessagesForLocale("en").activityCount(2)).toBe("2 activities");
    expect(activitiesMessagesForLocale("fa").activityCount(2)).toBe("۲ فعالیت");
    expect(settingsMessagesForLocale("en").profile).toBe("Personal preferences");
    expect(settingsMessagesForLocale("fa").profile).toBe("تنظیمات شخصی");
    expect(emailMessagesForLocale("en").title).toBe("Inbox");
    expect(emailMessagesForLocale("fa").title).toBe("صندوق ورودی");
    expect(enrichmentMessagesForLocale("en").button.label).toBe("Fill the gaps");
    expect(enrichmentMessagesForLocale("fa", "latn").dialog.apply(12)).toBe("ثبت 12 فیلد");
    expect(statsMessagesForLocale("en")._extra.durationDays(2)).toBe("2 days");
    expect(statsMessagesForLocale("fa")._extra.durationDays(2)).toBe("۲ روز");
  });
});
