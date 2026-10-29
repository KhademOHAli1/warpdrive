// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";

afterEach(cleanup);

const useQuery = vi.fn();
vi.mock("@/lib/trpc-client", () => ({
  trpc: { import: { listRows: { useQuery: (...a: unknown[]) => useQuery(...a) } } },
}));

import { PreviewStep } from "./PreviewStep";

it("shows the valid/invalid summary and lists row errors", () => {
  useQuery.mockReturnValue({
    data: [
      { id: "r1", rowNumber: 1, status: "valid", errors: [] },
      {
        id: "r2",
        rowNumber: 2,
        status: "invalid",
        errors: [{ field: "name", message: "Required" }],
      },
    ],
  });
  render(
    <PreviewStep
      batchId="b1"
      validation={{ valid: 1, invalid: 1 }}
      busy={false}
      onCommit={vi.fn()}
    />,
  );
  expect(screen.getByText("1 valid")).toBeInTheDocument();
  expect(screen.getByText("1 with errors")).toBeInTheDocument();
  expect(screen.getByText("Name: This field is required.")).toBeInTheDocument();
});

it("shows Persian labels, diagnostics, row numbers and status without leaking stored keys", () => {
  useQuery.mockReturnValue({
    data: [
      {
        id: "r1",
        rowNumber: 12,
        status: "invalid",
        errors: [
          { field: "organization.address.city", message: "Required" },
          { field: "customFields.customer_code", message: "required custom field is empty" },
          { field: "retiredDatabaseColumn", message: "old English database failure" },
        ],
      },
    ],
  });
  render(
    <LocaleProvider locale="fa">
      <PreviewStep
        batchId="b1"
        validation={{ valid: 1, invalid: 1 }}
        busy={false}
        onCommit={vi.fn()}
        target="person"
        defs={[
          {
            id: "cf1",
            targetEntity: "person",
            type: "text",
            name: "شناسه مشتری",
            key: "customer_code",
            options: [],
            isRequired: true,
            isImportant: false,
            showInAddForm: false,
            order: 0,
            archivedAt: null,
          },
        ]}
      />
    </LocaleProvider>,
  );
  expect(screen.getByText("#۱۲")).toBeInTheDocument();
  expect(screen.getByText(/سازمان\[نشانی: شهر\]: تکمیل این فیلد ضروری است./)).toBeInTheDocument();
  expect(screen.getByText(/شناسه مشتری: تکمیل این فیلد ضروری است./)).toBeInTheDocument();
  expect(screen.getByRole("button")).toHaveAccessibleName(/۱/);
  expect(document.body.textContent).not.toMatch(
    /retiredDatabaseColumn|old English database failure/,
  );
});

it("commits the valid rows when clicked and disables when nothing is valid", () => {
  useQuery.mockReturnValue({ data: [] });
  const onCommit = vi.fn();
  const { rerender } = render(
    <PreviewStep
      batchId="b1"
      validation={{ valid: 2, invalid: 0 }}
      busy={false}
      onCommit={onCommit}
    />,
  );
  const btn = screen.getByRole("button", { name: "Import 2 valid rows" });
  fireEvent.click(btn);
  expect(onCommit).toHaveBeenCalledOnce();
  rerender(
    <PreviewStep
      batchId="b1"
      validation={{ valid: 0, invalid: 3 }}
      busy={false}
      onCommit={onCommit}
    />,
  );
  expect(screen.getByRole("button", { name: "Import 0 valid rows" })).toBeDisabled();
});
