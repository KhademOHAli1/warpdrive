// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";

const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
const { list, lifecycle } = vi.hoisted(() => ({ list: vi.fn(), lifecycle: vi.fn() }));
vi.mock("@/config/env", () => ({ env: { SALES_PIPELINE_LIFECYCLE_ENABLED: false } }));
vi.mock("@/features/identity/settingsMessages.server", () => ({
  getServerSettingsMessages: () => Promise.resolve(settingsMessagesForLocale("en")),
}));
vi.mock("@/server/trpc/context", () => ({
  createContext: () => Promise.resolve({ actor: { type: "admin", id: "viewer" } }),
}));
vi.mock("@/server/trpc/root", () => ({ createCaller: () => ({ pipeline: { list } }) }));
vi.mock("@/features/pipelines/pipelineLifecycle", () => ({ listLifecyclePipelines: lifecycle }));
vi.mock("@/features/pipelines/PipelineDirectoryClient", () => ({
  PipelineDirectoryClient: () => null,
}));
vi.mock("@/features/pipelines/CreatePipelineButton", () => ({
  CreatePipelineButton: () => <button type="button">Create pipeline</button>,
}));

import PipelinesSettingsPage from "./page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("marks each existing fallback settings editor entry and retains its row anchor and stage count", async () => {
  list.mockResolvedValue(
    ids.map((id, index) => ({ id, name: `Pipeline ${index + 1}`, stages: [{ id: `s${index}` }] })),
  );
  render(await PipelinesSettingsPage());
  const editLinks = screen.getAllByRole("link", { name: "Edit stages" });
  expect(editLinks).toHaveLength(2);
  for (const [index, id] of ids.entries()) {
    expect(editLinks[index]).toHaveAttribute("href", `/pipeline/${id}/edit?from=settings`);
    expect(editLinks[index]?.closest("li")).toHaveAttribute("id", `pipeline-${id}`);
    expect(editLinks[index]?.closest("li")).toHaveTextContent("1 stage");
  }
  expect(list).toHaveBeenCalledTimes(1);
  expect(lifecycle).not.toHaveBeenCalled();
});
