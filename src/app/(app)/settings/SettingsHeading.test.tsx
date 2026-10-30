// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsHeading } from "./SettingsHeading";

afterEach(cleanup);

describe("SettingsHeading", () => {
  it("renders a 'Settings / X' breadcrumb linking back to the settings index", () => {
    render(<SettingsHeading title="Users" />);
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByRole("heading", { level: 1, name: "Users" })).not.toBeNull();
  });
});

it("distinguishes account preferences from workspace configuration", () => {
  const { rerender } = render(<SettingsHeading title="Users" scope="workspace" />);
  expect(screen.getByText("Whole workspace")).not.toBeNull();
  rerender(<SettingsHeading title="Language & region" scope="personal" />);
  expect(screen.getByText("Only you")).not.toBeNull();
  rerender(<SettingsHeading title="Templates & signatures" scope="mixed" />);
  expect(screen.getByText("Personal & shared")).not.toBeNull();
});
