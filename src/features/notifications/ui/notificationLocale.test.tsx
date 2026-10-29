// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { NotificationItem } from "./NotificationItem";

afterEach(cleanup);

it("localizes notification wording while retaining the original record title", () => {
  render(
    <LocaleProvider locale="fa">
      <NotificationItem
        item={{
          id: "n1",
          userId: "u1",
          type: "mention",
          entityType: "deal",
          entityId: "d1",
          actorId: "u2",
          payload: { title: "Acme renewal" },
          readAt: null,
          createdAt: "2026-10-29T12:00:00Z",
          band: "today",
        }}
        onOpen={() => {}}
      />
    </LocaleProvider>,
  );
  expect(screen.getByRole("button")).toHaveTextContent("از شما نام برده شد");
  expect(screen.getByRole("button")).toHaveTextContent("Acme renewal");
});
