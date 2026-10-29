import { createAppTranslator } from "./catalog";

// Compile-only contract: typecheck must generate literal JSON declarations before running tsc.
export function assertTranslationTypes(): void {
  const calendar = createAppTranslator("en", "calendar");
  calendar("showMore", { count: 2 });
  calendar("weekOf", { date: "1 January" });
  // @ts-expect-error unknown message keys must fail compilation
  calendar("missingMessage");
  // @ts-expect-error required ICU interpolation values must be supplied
  calendar("weekOf");
  // @ts-expect-error plural counts must be numeric
  calendar("showMore", { count: "two" });
}
