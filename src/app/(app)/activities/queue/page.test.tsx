// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  enabled: false,
  context: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("route-not-found");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock("@/config/env", () => ({
  env: {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
    get SALES_NEXT_ACTION_QUEUE_ENABLED() {
      return boundary.enabled;
    },
  },
}));
vi.mock("next/navigation", () => ({ notFound: boundary.notFound, redirect: boundary.redirect }));
vi.mock("@/server/trpc/context", () => ({ createContext: boundary.context }));
vi.mock("@/features/i18n/server", async () => {
  const { createAppTranslator } = await import("@/features/i18n/catalog");
  return {
    getAppTranslations: () => Promise.resolve(createAppTranslator("fa", "nextActionQueue")),
  };
});
vi.mock("@/features/activities/NextActionQueueClient", () => ({
  NextActionQueueClient: ({ currentUserId }: { currentUserId: string }) => (
    <div data-testid="native-queue" data-actor={currentUserId} />
  ),
}));

import Page, { generateMetadata } from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  boundary.enabled = true;
  boundary.context.mockResolvedValue({
    actor: { id: "protected-native-actor", isActive: true },
    session: { userId: "protected-native-actor", sessionId: "native-session" },
  });
});
afterEach(cleanup);

test("a disabled queue is unavailable before loading session or account context", async () => {
  boundary.enabled = false;
  await expect(Page()).rejects.toThrow("route-not-found");
  expect(boundary.context).not.toHaveBeenCalled();
});

test.each([
  { actor: null, session: { userId: "old-actor", sessionId: "expired" } },
  { actor: { id: "old-actor", isActive: true }, session: null },
  { actor: { id: "old-actor", isActive: false }, session: { sessionId: "old" } },
])("an enabled queue requires an active actor and native session", async (context) => {
  boundary.context.mockResolvedValue(context);
  await expect(Page()).rejects.toThrow("redirect:/login");
  expect(screen.queryByTestId("native-queue")).not.toBeInTheDocument();
});

test("renders with only the protected actor identity and account language", async () => {
  render(await Page());
  expect(screen.getByTestId("native-queue")).toHaveAttribute(
    "data-actor",
    "protected-native-actor",
  );
  expect(screen.getByRole("main")).toHaveAccessibleName("اقدام‌های بعدی");
  await expect(generateMetadata()).resolves.toEqual({ title: "اقدام‌های بعدی" });
});
