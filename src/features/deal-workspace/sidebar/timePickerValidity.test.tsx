// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CustomFieldDef } from "@/types/customFields";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { createPerson, updateDeal } = vi.hoisted(() => ({
  createPerson: vi.fn(() => Promise.resolve({ ok: true, value: { id: "person" } })),
  updateDeal: vi.fn(() => Promise.resolve({ ok: true })),
}));
vi.mock("@/features/contacts/actions", () => ({ createPersonAction: createPerson }));
vi.mock("@/features/deals/updateAction", () => ({ updateDealAction: updateDeal }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

import { DetailsBlock } from "./DetailsBlock";
import { PersonLinkEditor } from "./PersonLinkEditor";

const timeField: CustomFieldDef = {
  id: "time-field",
  targetEntity: "deal",
  type: "time",
  name: "Follow-up time",
  key: "time",
  options: [],
  isRequired: false,
  isImportant: false,
  showInAddForm: true,
  order: 0,
  archivedAt: null,
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function validThenInvalid(): void {
  const input = screen.getByLabelText("Follow-up time");
  fireEvent.change(input, { target: { value: "09:00" } });
  fireEvent.blur(input);
  fireEvent.change(input, { target: { value: "99:99" } });
  fireEvent.blur(input);
}

it("does not bulk-save a stale canonical field while an invalid raw time is shown", () => {
  const onSave = vi.fn(() => Promise.resolve({ ok: true as const, value: {} }));
  const onExit = vi.fn();
  render(
    <DetailsBlock
      customFieldDefs={[timeField]}
      customFields={{ time: "08:00" }}
      currency="USD"
      onSave={onSave}
      bulkEditing
      onExitBulk={onExit}
    />,
  );
  validThenInvalid();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave).not.toHaveBeenCalled();
  expect(onExit).not.toHaveBeenCalled();
});

it("does not create and link a person while an invalid raw time is shown", () => {
  render(
    <PersonLinkEditor
      dealId="deal"
      expectedUpdatedAt="2027-03-21T00:00:00Z"
      personOptions={[]}
      hidden={new Set()}
      customFieldDefs={[{ ...timeField, targetEntity: "person" }]}
      onDone={vi.fn()}
      onError={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ali" } });
  validThenInvalid();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(createPerson).not.toHaveBeenCalled();
  expect(updateDeal).not.toHaveBeenCalled();
});
