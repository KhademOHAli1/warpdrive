// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SidebarChrome } from "./SidebarChrome";
import { WorkspaceShellProvider } from "./WorkspaceShellProvider";

afterEach(cleanup);
it("uses company identity and legible initial fallback in the desktop and mobile chrome", () => {
  render(
    <WorkspaceShellProvider
      brand={{
        displayName: "Acme Studio",
        iconUrl: null,
        accentColor: "#000000",
        foregroundColor: "#ffffff",
      }}
      modules={[]}
      canViewWork={false}
    >
      <SidebarChrome expanded />
    </WorkspaceShellProvider>,
  );
  expect(screen.getByRole("link").getAttribute("aria-label")).toContain("Acme Studio");
  expect(screen.getByText("AC")).toBeTruthy();
  expect(screen.getByText("Acme Studio")).toBeTruthy();
});
