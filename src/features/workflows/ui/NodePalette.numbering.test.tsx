// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import type { NumberingSystem } from "@/lib/numberingSystem";
import type { PickerSelection } from "../paletteContext";
import { NodePalette } from "./NodePalette";
import { paletteDefinition, readyPaletteRead } from "./palette.TestHelpers";
import { buildPaletteView } from "./paletteView";

afterEach(cleanup);

interface PaletteBoundsScenario {
  name: string;
  locale: Locale;
  numberingSystem: NumberingSystem | undefined;
  buttonName: RegExp;
  expectedDays: readonly string[];
}

const scenarios: PaletteBoundsScenario[] = [
  {
    name: "Farsi with default Persian digits",
    locale: "fa",
    numberingSystem: undefined,
    buttonName: /^انتظار/,
    expectedDays: ["۳۶۵"],
  },
  {
    name: "English with explicit Persian digits",
    locale: "en",
    numberingSystem: "arabext",
    buttonName: /^Delay/,
    expectedDays: ["۳۶۵"],
  },
  {
    name: "Farsi with explicit Latin digits",
    locale: "fa",
    numberingSystem: "latn",
    buttonName: /^انتظار/,
    expectedDays: ["365"],
  },
  {
    name: "English with explicit Latin digits",
    locale: "en",
    numberingSystem: "latn",
    buttonName: /^Delay/,
    expectedDays: ["365"],
  },
];

it.each(scenarios)(
  "shows the localized maximum duration in the palette for $name",
  ({ locale, numberingSystem, buttonName, expectedDays }) => {
    const onChoose = vi.fn<(selection: PickerSelection) => void>();
    const onClose = vi.fn<() => void>();
    const preferences = numberingSystem === undefined ? { locale } : { locale, numberingSystem };
    const model = buildPaletteView(
      paletteDefinition(),
      { kind: "detached" },
      readyPaletteRead(),
      true,
    );
    render(
      <LocaleProvider {...preferences}>
        <NodePalette open onClose={onClose} model={model} onChoose={onChoose} />
      </LocaleProvider>,
    );
    const wait = screen.getByRole("button", { name: buttonName });
    expect(wait).toBeVisible();
    expect(onChoose).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // The maximum duration follows the user’s selected digits in the accessible description.
    const bounds = (wait.textContent ?? "").replaceAll(/[,٬]/g, "").match(/[0-9۰-۹٠-٩]+/g);
    expect(bounds).toEqual(expectedDays);
  },
);
