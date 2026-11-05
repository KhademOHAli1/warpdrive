import { describe, expect, it } from "vitest";
import { initialBlankDefinition, initialDefinition } from "../editorModel";
import type { WorkflowDefinition } from "../schemas";
import {
  capturePublicationReview,
  publicationReviewCurrent,
  publicationReviewSteps,
} from "./publicationReview";

function source() {
  return {
    name: "Reviewed workflow",
    definition: initialBlankDefinition("Manual start"),
    revision: 7,
    dirty: false,
    active: false,
    number: null as number | null,
    archivedAt: null as Date | null,
    available: true,
    capabilities: { edit: true, publish: true },
  };
}
describe("exact local publication review cut", () => {
  it("accepts an unchanged current cut without treating it as an authority token", () => {
    const current = source();
    const snapshot = capturePublicationReview(current);
    expect(publicationReviewCurrent(snapshot, current)).toBe(true);
    expect(snapshot.name).toBe("Reviewed workflow");
    expect(snapshot.revision).toBe(7);
    expect(snapshot.definition).toBe(current.definition);
  });
  it.each([
    ["name", (current: ReturnType<typeof source>) => ({ ...current, name: "Changed name" })],
    ["revision", (current: ReturnType<typeof source>) => ({ ...current, revision: 8 })],
    [
      "graph",
      (current: ReturnType<typeof source>) => ({
        ...current,
        definition: initialBlankDefinition("Changed trigger"),
      }),
    ],
    [
      "layout",
      (current: ReturnType<typeof source>) => ({
        ...current,
        definition: { ...current.definition, layout: { start: { x: 20, y: 30 } } },
      }),
    ],
    ["dirty baseline", (current: ReturnType<typeof source>) => ({ ...current, dirty: true })],
    [
      "publish permission",
      (current: ReturnType<typeof source>) => ({
        ...current,
        capabilities: { ...current.capabilities, publish: false },
      }),
    ],
    [
      "edit permission",
      (current: ReturnType<typeof source>) => ({
        ...current,
        capabilities: { ...current.capabilities, edit: false },
      }),
    ],
    ["access", (current: ReturnType<typeof source>) => ({ ...current, available: false })],
    [
      "archive",
      (current: ReturnType<typeof source>) => ({
        ...current,
        archivedAt: new Date("2026-11-05T00:00:00Z"),
      }),
    ],
    [
      "publication",
      (current: ReturnType<typeof source>) => ({ ...current, active: true, number: 3 }),
    ],
  ] as const)("rejects a changed %s cut", (_name, change) => {
    const current = source();
    expect(publicationReviewCurrent(capturePublicationReview(current), change(current))).toBe(
      false,
    );
  });
  it("does not include transient notice or error fields in the reviewed graph cut", () => {
    const current = source();
    const withError = { ...current, error: "notReady" };
    expect(publicationReviewCurrent(capturePublicationReview(current), withError)).toBe(true);
  });
});
describe("publication step descriptions", () => {
  it("describes configured task steps without disclosing their literal or mapped payloads", () => {
    const definition = initialDefinition({
      start: "Manual",
      read: "Read selected deal",
      task: "Create follow-up",
      subject: "Private authored subject",
    });
    const rows = publicationReviewSteps(definition);
    expect(rows).toEqual([
      {
        id: "start",
        name: "Manual",
        labelKey: "paletteManual",
        descriptionKey: "publicationManualStep",
        ready: true,
      },
      {
        id: "read",
        name: "Read selected deal",
        labelKey: "read",
        descriptionKey: "publicationReadStep",
        ready: true,
      },
      {
        id: "task",
        name: "Create follow-up",
        labelKey: "task",
        descriptionKey: "publicationTaskStep",
        ready: true,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("Private authored subject");
    expect(JSON.stringify(rows)).not.toContain("recordId");
  });
  it("labels unavailable configured profiles without claiming their provider requirements", () => {
    const definition: WorkflowDefinition = {
      schemaVersion: 1,
      nodes: [
        {
          id: "start",
          name: "Record event",
          type: "trigger.record",
          version: 1,
          config: { entity: "deal", event: "created" },
        },
        {
          id: "notice",
          name: "Notice",
          type: "notification",
          version: 1,
          config: { title: { kind: "value", value: "Private notice" } },
        },
      ],
      edges: [{ from: "start", to: "notice", port: "next" }],
    };
    expect(publicationReviewSteps(definition)).toEqual([
      {
        id: "start",
        name: "Record event",
        labelKey: "paletteRecordTrigger",
        descriptionKey: "publicationUnavailableStep",
        ready: false,
      },
      {
        id: "notice",
        name: "Notice",
        labelKey: "notification",
        descriptionKey: "publicationUnavailableStep",
        ready: false,
      },
    ]);
  });
  it("checks the configured handler profile instead of only the node's palette category", () => {
    const definition = initialDefinition({
      start: "Manual",
      read: "Read person",
      task: "Task",
      subject: "Follow up",
    });
    const changed: WorkflowDefinition = {
      ...definition,
      nodes: definition.nodes.map((node) =>
        node.id === "read" ? { ...node, config: { ...node.config, entity: "person" } } : node,
      ),
    };
    expect(publicationReviewSteps(changed).find((step) => step.id === "read")).toMatchObject({
      ready: false,
      descriptionKey: "publicationUnavailableStep",
    });
  });
});
