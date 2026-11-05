import { expect, it } from "vitest";
import { referenceNeedles } from "./undo-references";

it("protects descendant stage references as well as parent configuration IDs", () => {
  const needles = referenceNeedles({
    kind: "pipeline",
    id: "pipeline-id",
    key: "stable-key",
    created: true,
    snapshot: { stages: [{ id: "stage-id" }] },
  });
  expect(needles).toContain(JSON.stringify("stage-id"));
});
