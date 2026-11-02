// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import type { NumberingSystem } from "@/lib/numberingSystem";
import type { CreatableNodeType } from "../nodeFactory";
import { NodePalette } from "./NodePalette";

afterEach(cleanup);

interface PaletteBoundsScenario {
  name: string;
  locale: Locale;
  numberingSystem: NumberingSystem | undefined;
  buttonName: RegExp;
  expectedBounds: readonly string[];
}

const scenarios: PaletteBoundsScenario[] = [
  {
    name: "Farsi with default Persian digits",
    locale: "fa",
    numberingSystem: undefined,
    buttonName: /^انتظار/,
    expectedBounds: ["۱", "۵۲۵۶۰۰"],
  },
  {
    name: "English with explicit Persian digits",
    locale: "en",
    numberingSystem: "arabext",
    buttonName: /^Wait/,
    expectedBounds: ["۱", "۵۲۵۶۰۰"],
  },
  {
    name: "Farsi with explicit Latin digits",
    locale: "fa",
    numberingSystem: "latn",
    buttonName: /^انتظار/,
    expectedBounds: ["1", "525600"],
  },
  {
    name: "English with explicit Latin digits",
    locale: "en",
    numberingSystem: "latn",
    buttonName: /^Wait/,
    expectedBounds: ["1", "525600"],
  },
];

it.each(scenarios)(
  "shows selected-numbering duration bounds in the palette for $name",
  ({ locale, numberingSystem, buttonName, expectedBounds }) => {
    const onAdd = vi.fn<(type: CreatableNodeType) => void>();
    const onClose = vi.fn<() => void>();
    const preferences = numberingSystem === undefined ? { locale } : { locale, numberingSystem };
    render(
      <LocaleProvider {...preferences}>
        <NodePalette open onClose={onClose} onAdd={onAdd} />
      </LocaleProvider>,
    );
    const wait = screen.getByRole("button", { name: buttonName });
    expect(wait).toBeVisible();
    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // Grouping punctuation is presentation; selected digits and both bounds must remain visible.
    const bounds = (wait.textContent ?? "").replaceAll(/[,٬]/g, "").match(/[0-9۰-۹٠-٩]+/g);
    expect(bounds).toEqual(expectedBounds);
  },
);
