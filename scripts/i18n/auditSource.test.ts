import { describe, expect, it } from "vitest";
import { auditSource } from "./auditSource";

describe("localization source inventory", () => {
  it("includes custom accessibility role descriptions as user-facing copy", () => {
    expect(
      auditSource('<button aria-roledescription="draggable card" />', "src/Card.tsx").map(
        (f) => f.text,
      ),
    ).toEqual(["draggable card"]);
  });
  it("finds visible copy and accessible labels without treating code or styling as copy", () => {
    const source = `import {STRINGS as S} from "@/constants/strings";
      export const View = () => <button className="text-left" aria-label="Close dialog">Save changes</button>;`;
    const findings = auditSource(source, "src/View.tsx");
    expect(findings.map((finding) => [finding.kind, finding.text])).toEqual([
      ["legacy-catalog", "@/constants/strings"],
      ["literal", "Close dialog"],
      ["literal", "Save changes"],
    ]);
  });

  it("finds conditional and interpolated text and retains an actionable source location", () => {
    const findings = auditSource(
      `export const View = () => <p>{busy ? "Saving…" : \`Saved \${count} items\`}</p>;`,
      "src/View.tsx",
    );
    expect(findings.map((finding) => finding.text)).toEqual(["Saving…", "Saved {…} items"]);
    expect(findings.every((finding) => finding.line === 1)).toBe(true);
  });

  it("ignores message keys, identifiers, URLs and empty presentational content", () => {
    expect(
      auditSource(
        `export const View = () => <a href="/settings" data-testid="settings">{t("settings.title")}</a>;`,
        "src/View.tsx",
      ),
    ).toEqual([]);
  });

  it("does not confuse a machine-state comparison with visible copy", () => {
    const findings = auditSource(
      `export const View = () => <p>{status === "active" && "Enabled"}</p>;`,
      "src/View.tsx",
    );
    expect(findings.map((finding) => finding.text)).toEqual(["Enabled"]);
  });

  it("does not count compile-only legacy shape imports as untranslated runtime copy", () => {
    expect(
      auditSource(
        `import type {STRINGS} from "@/constants/strings"; import {type SETTINGS_STRINGS} from "@/constants/settingsStrings";`,
        "src/types.ts",
      ),
    ).toEqual([]);
  });

  it("distinguishes localized message factories from the legacy English constants", () => {
    expect(
      auditSource(
        `import {createSalesStrings} from "@/features/deals/salesStrings"; import {useActivitiesStrings} from "./useActivitiesStrings";`,
        "src/View.tsx",
      ),
    ).toEqual([]);
    expect(
      auditSource(
        `import {ACTIVITY_STRINGS} from "../../constants/activityStrings";`,
        "src/View.tsx",
      ),
    ).toHaveLength(1);
  });
});
