// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { actorState, list, redirect } = vi.hoisted(() => ({
  actorState: { value: { type: "member", flags: new Set<string>() } },
  list: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/server/trpc/context", () => ({
  createContext: () => Promise.resolve({ actor: actorState.value }),
}));
vi.mock("@/server/trpc/root", () => ({ createCaller: () => ({ pipeline: { list } }) }));
vi.mock("@/features/i18n/server", () => ({
  getLocalePreferences: () => Promise.resolve({ locale: "en" }),
  getAppTranslations: () => Promise.resolve((key: string) => key),
}));
vi.mock("@/features/pipelines/pipelineEditActions", () => ({ createPipelineAction: vi.fn() }));
vi.mock("@/features/pipelines/CreatePipelineButton", () => ({
  CreatePipelineButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "test-csrf" }));

import PipelineIndexPage from "./page";

beforeEach(() => {
  actorState.value = { type: "member", flags: new Set<string>() };
  list.mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each(["member", "admin"])("keeps Performance reachable without visible pipelines for a %s", async (type) => {
  actorState.value.type = type;
  const user = userEvent.setup();
  render(await PipelineIndexPage());
  await user.click(screen.getByRole("button", { name: /dashboard/i }));
  expect(screen.getByRole("menuitem", { name: /Performance/ })).toHaveAttribute("href", "/dashboard");
  expect(screen.queryByRole("menuitem", { name: /hidden pipeline/i })).not.toBeInTheDocument();
});

it.each(["member", "admin"])("retains the first-pipeline creation gate for a %s", async (type) => {
  actorState.value.type = type;
  render(await PipelineIndexPage());
  const create = screen.queryByRole("button", { name: "Create your first pipeline" });
  if (type === "admin") expect(create).toBeInTheDocument();
  else expect(create).not.toBeInTheDocument();
});

it("continues to open the first visible pipeline when one is available", async () => {
  list.mockResolvedValue([{ id: "visible-pipeline", name: "Sales" }]);
  await PipelineIndexPage();
  expect(redirect).toHaveBeenCalledWith("/pipeline/visible-pipeline");
});
