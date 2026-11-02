import { expect, it } from "vitest";
import { previewTemplateDates } from "./templateDatePreview";
import { invalidDate, withDateManifest } from "./templateDatePreview.test-support";

it(
  "rejects a final line terminator even when no intents trigger date arithmetic",
  withDateManifest((manifest) => {
    expect(previewTemplateDates(manifest, "2026-03-01\n")).toEqual(invalidDate);
  }, [0, 0, 0], []),
);
