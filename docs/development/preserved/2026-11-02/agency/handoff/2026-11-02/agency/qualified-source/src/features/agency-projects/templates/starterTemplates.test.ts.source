import { describe, expect, it } from "vitest";
import { listStarterTemplates, readStarterTemplate } from "./starterTemplates";
import { parseTemplateManifestJson } from "./templateManifest";

const starterIds = ["modeling_project", "short_video", "campaign_content"];

describe("production starter template catalog v1", () => {
  it("lists the three bounded starter versions through the manifest boundary", () => {
    const result = listStarterTemplates();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((manifest) => manifest.templateId)).toEqual(starterIds);
    for (const manifest of result.value) {
      expect(manifest.version).toBe(1);
      expect(manifest.schemaVersion).toBe(1);
      expect(parseTemplateManifestJson(JSON.stringify(manifest))).toEqual({
        ok: true,
        value: manifest,
      });
    }
  });

  it.each(starterIds)("reads %s with complete FA/DE/EN scope and date-review assumptions", (id) => {
    const result = readStarterTemplate(id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.templateId).toBe(id);
    expect(result.value.label.fa).toMatch(/[\u0600-\u06ff]/u);
    expect(result.value.label.de.length).toBeGreaterThan(0);
    expect(result.value.label.en.length).toBeGreaterThan(0);
    expect(result.value.description.fa).toContain("پیشنهادی");
    expect(result.value.description.de).toContain("Annahmen");
    expect(result.value.description.en).toContain("assumptions");
    expect(result.value.intents.length).toBeGreaterThan(0);
    expect(
      result.value.intents.every(
        (intent) =>
          intent.dueOffset.basis === "calendar-days" && intent.dueOffset.anchor === "project-start",
      ),
    ).toBe(true);
  });

  it("models an unresolved modeler assignment and a later-stage model review", () => {
    const result = readStarterTemplate("modeling_project");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "producer", kind: "internal-producer" }),
        expect.objectContaining({ id: "modeler", kind: "freelancer-contact" }),
      ]),
    );
    expect(result.value.deliverables).toEqual([
      expect.objectContaining({ id: "model", stageId: "production" }),
    ]);
    expect(result.value.intents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "assignment",
          deliverableId: "model",
          freelancerRoleId: "modeler",
        }),
        expect.objectContaining({
          kind: "review",
          deliverableId: "model",
          stageId: "internal_review",
        }),
        expect.objectContaining({ kind: "follow-up" }),
      ]),
    );
  });

  it("models an unresolved editor, video cut and later internal review", () => {
    const result = readStarterTemplate("short_video");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "editor", kind: "freelancer-contact" }),
      ]),
    );
    expect(result.value.deliverables).toEqual([expect.objectContaining({ id: "video_cut" })]);
    expect(result.value.intents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "assignment",
          deliverableId: "video_cut",
          freelancerRoleId: "editor",
        }),
        expect.objectContaining({
          kind: "review",
          deliverableId: "video_cut",
          stageId: "internal_review",
        }),
      ]),
    );
  });

  it("keeps campaign design and editing assignments separate, with two deliverables", () => {
    const result = readStarterTemplate("campaign_content");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.value.roles
        .filter((role) => role.kind === "freelancer-contact")
        .map((role) => role.id),
    ).toEqual(["designer", "editor"]);
    expect(result.value.deliverables.map((deliverable) => deliverable.id)).toEqual([
      "campaign_design",
      "campaign_cut",
    ]);
    expect(result.value.intents.filter((intent) => intent.kind === "assignment")).toHaveLength(2);
    expect(result.value.intents.filter((intent) => intent.kind === "review")).toHaveLength(2);
  });

  it.each(["missing", "", "../short_video", "modeling_project@2"])(
    "keeps unknown template %s unavailable",
    (id) => {
      expect(readStarterTemplate(id)).toEqual({ ok: false, error: "starter_unavailable" });
    },
  );

  it("does not embed identities, recipients, approval, commercial or activation fields", () => {
    const result = listStarterTemplates();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toMatch(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/iu,
    );
    expect(serialized).not.toMatch(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu);
    for (const key of [
      "userId",
      "contactId",
      "recipient",
      "recipients",
      "activate",
      "action",
      "approval",
      "approvedAt",
      "budget",
      "price",
      "currency",
      "includedRevisionRounds",
      "availability",
    ]) {
      expect(serialized).not.toContain(`"${key}":`);
    }
  });

  it("isolates caller edits from future individual and catalog reads", () => {
    const first = readStarterTemplate("modeling_project");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const original = structuredClone(first.value);
    first.value.label.fa = "ویرایش محلی";
    first.value.roles.splice(0);
    first.value.intents[0]?.dependsOn.push("unmapped");
    expect(readStarterTemplate("modeling_project")).toEqual({ ok: true, value: original });
    const catalog = listStarterTemplates();
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) return;
    catalog.value[0]?.stages.splice(0);
    const reread = listStarterTemplates();
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    expect(reread.value[0]).toEqual(original);
    expect(reread.value).toHaveLength(3);
  });
});
