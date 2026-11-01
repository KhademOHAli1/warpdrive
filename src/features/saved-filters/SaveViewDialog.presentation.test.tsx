// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedViewDefinition } from "./savedView";

const createSavedFilterAction = vi.fn();
vi.mock("./serverActions", () => ({
  createSavedFilterAction: (...args: unknown[]) => createSavedFilterAction(...args),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

import { SaveViewDialog } from "./SaveViewDialog";

const PRESENTATION = {
  version: 1 as const,
  columns: ["name", "email"],
  sort: { field: "name", dir: "desc" as const },
};
const EMPTY: SavedViewDefinition = { combinator: "and", conditions: [] };
const CONDITIONS: SavedViewDefinition = {
  combinator: "or",
  conditions: [{ field: "primaryEmail", op: "contains", value: "kunde" }],
};

beforeEach(() =>
  createSavedFilterAction.mockResolvedValue({ ok: true, value: { id: "new-view" } }),
);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("View name"), "فروش / Vertrieb");
  await user.click(screen.getByRole("button", { name: "Save" }));
}

describe("SaveViewDialog presentation persistence", () => {
  it.each([EMPTY, CONDITIONS])(
    "saves a versioned envelope and returns the captured layout for %j",
    async (definition) => {
      const user = userEvent.setup();
      const onSaved = vi.fn();
      const original = structuredClone(definition);
      render(
        <SaveViewDialog
          targetEntity="person"
          definition={definition}
          onClose={vi.fn()}
          onSaved={onSaved}
          {...{ presentation: PRESENTATION }}
        />,
      );
      await save(user);
      expect(createSavedFilterAction).toHaveBeenCalledWith(
        {
          name: "فروش / Vertrieb",
          targetEntity: "person",
          isShared: false,
          definition: {
            version: 1,
            targetEntity: "person",
            definition,
            presentation: PRESENTATION,
          },
        },
        "csrf",
      );
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "new-view",
          name: "فروش / Vertrieb",
          definition,
          presentation: PRESENTATION,
        }),
      );
      expect(definition).toEqual(original);
    },
  );

  it("keeps the legacy payload and client view shape when no presentation is supplied", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(
      <SaveViewDialog
        targetEntity="person"
        definition={CONDITIONS}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    await save(user);
    expect(createSavedFilterAction).toHaveBeenCalledWith(
      { name: "فروش / Vertrieb", targetEntity: "person", definition: CONDITIONS, isShared: false },
      "csrf",
    );
    expect(onSaved).toHaveBeenCalledWith({
      id: "new-view",
      name: "فروش / Vertrieb",
      favorite: false,
      isShared: false,
      isOwn: true,
      definition: CONDITIONS,
    });
  });
});
