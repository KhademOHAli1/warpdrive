// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import type { NumberingSystem } from "@/lib/numberingSystem";
import type { Binding } from "../schemas";
import { DelayFields } from "./DelayFields";

afterEach(cleanup);

interface BoundsScenario {
  name: string;
  locale: Locale;
  numberingSystem: NumberingSystem | undefined;
  label: string;
  expectedBounds: readonly string[];
}

const scenarios: BoundsScenario[] = [
  {
    name: "Farsi with default Persian digits",
    locale: "fa",
    numberingSystem: undefined,
    label: "مدت انتظار (دقیقه)",
    expectedBounds: ["۱", "۵۲۵۶۰۰"],
  },
  {
    name: "English with explicit Persian digits",
    locale: "en",
    numberingSystem: "arabext",
    label: "Wait duration (minutes)",
    expectedBounds: ["۱", "۵۲۵۶۰۰"],
  },
  {
    name: "Farsi with explicit Latin digits",
    locale: "fa",
    numberingSystem: "latn",
    label: "مدت انتظار (دقیقه)",
    expectedBounds: ["1", "525600"],
  },
  {
    name: "English with explicit Latin digits",
    locale: "en",
    numberingSystem: "latn",
    label: "Wait duration (minutes)",
    expectedBounds: ["1", "525600"],
  },
];

it.each(scenarios)(
  "formats accessible duration bounds for $name",
  ({ locale, numberingSystem, label, expectedBounds }) => {
    const config: { minutes: Binding } = { minutes: { kind: "value", value: 60 } };
    const onChange = vi.fn<(binding: Binding) => void>();
    const preferences = numberingSystem === undefined ? { locale } : { locale, numberingSystem };
    render(
      <LocaleProvider {...preferences}>
        <DelayFields value={config.minutes} editable onChange={onChange} />
      </LocaleProvider>,
    );
    const input = screen.getByLabelText(label);
    expect(input).toHaveValue("60");
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(onChange).not.toHaveBeenCalled();
    expect(config).toEqual({ minutes: { kind: "value", value: 60 } });

    const hintId = input.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    const hint = hintId === null ? null : document.getElementById(hintId);
    expect(hint).toBeInTheDocument();
    const hintText = hint?.textContent ?? "";
    expect(hintText).not.toBe("");
    expect(input).toHaveAccessibleDescription(hintText);
    // Grouping punctuation is presentation; digit choice and numeric bounds are the contract.
    const bounds = hintText.replaceAll(/[,٬]/g, "").match(/[0-9۰-۹٠-٩]+/g);
    expect(bounds).toEqual(expectedBounds);
  },
);
