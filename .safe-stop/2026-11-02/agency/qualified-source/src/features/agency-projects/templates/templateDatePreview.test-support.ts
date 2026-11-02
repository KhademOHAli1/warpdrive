import { expect } from "vitest";
import { parseTemplateManifestJson } from "./templateManifest";
import { manifestFixture } from "./templateManifest.test-support";
import type { TemplateManifest } from "./templateManifestSchemas";

type IntentIndex = 0 | 1 | 2;

export const invalidDate = { ok: false, error: "invalid_date" };

export function withDateManifest(
  run: (manifest: TemplateManifest) => void,
  offsets: readonly [number, number, number] = [0, 0, 0],
  order: readonly IntentIndex[] = [0, 1, 2],
) {
  return () => {
    const fixture = manifestFixture();
    const source = {
      ...fixture,
      templateId: "dated_preview",
      version: 7,
      intents: order.map((index) => ({
        ...fixture.intents[index],
        dueOffset: { ...fixture.intents[index].dueOffset, days: offsets[index] },
      })),
    };
    const parsed = parseTemplateManifestJson(JSON.stringify(source));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    run(parsed.value);
  };
}
