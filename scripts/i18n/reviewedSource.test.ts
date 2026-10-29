import { expect, it } from "vitest";
import { auditSource } from "./auditSource";
import { partitionReviewedSources } from "./reviewedSource";

it("excludes only an explicitly reviewed exact source finding", () => {
  const findings = auditSource(
    'import {NOTIFY_STRINGS} from "@/constants/notifyStrings";',
    "src/mapper.ts",
  );
  const first = findings[0];
  if (first === undefined) throw new Error("Missing fixture finding");
  const review = {
    ...first,
    reason:
      "Compared against persisted legacy payloads; translated labels are rendered separately.",
  };
  expect(partitionReviewedSources(findings, [review]).remaining).toEqual([]);
  expect(
    partitionReviewedSources(findings, [{ ...review, file: "src/other.ts" }]).remaining,
  ).toEqual(findings);
  expect(
    partitionReviewedSources(findings, [{ ...review, text: "another catalog" }]).stale,
  ).toHaveLength(1);
  expect(partitionReviewedSources([], [review]).stale).toHaveLength(1);
});
