// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";

const downloadAction = vi.fn().mockResolvedValue({ ok: false, error: { id: "E_FILE" } });
const query = vi.fn();
const requestUpload = vi.fn();
vi.mock("@/lib/trpc-client", () => ({
  trpc: { files: { listForEntity: { useQuery: () => query() } } },
}));
vi.mock("./serverActions", () => ({
  requestUploadAction: (...args: unknown[]) => requestUpload(...args),
  confirmUploadAction: vi.fn(),
  requestDownloadAction: (...args: unknown[]) => downloadAction(...args),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

import { FileAttachments } from "./FileAttachments";
import { uploadOneFile } from "./uploadHandshake";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("Persian attachment controls", () => {
  it("preserves filenames and localizes download names and size", () => {
    query.mockReturnValue({
      data: [
        { id: "f1", filename: "report-۱۴۰۵.pdf", sizeBytes: 2048, contentType: "application/pdf" },
      ],
      isLoading: false,
      isError: false,
    });
    render(
      <LocaleProvider locale="fa">
        <FileAttachments entityType="person" entityId="p1" readOnly />
      </LocaleProvider>,
    );
    expect(screen.getByRole("button", { name: "دریافت report-۱۴۰۵.pdf" })).toHaveTextContent(
      "report-۱۴۰۵.pdf",
    );
    expect(screen.getByText("۲ کیلوبایت")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "بارگذاری فایل" })).not.toBeInTheDocument();
  });
  it("shows a loading state rather than claiming there are no attachments", () => {
    query.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    render(
      <LocaleProvider locale="fa">
        <FileAttachments entityType="person" entityId="p1" />
      </LocaleProvider>,
    );
    expect(screen.getByText("در حال دریافت فایل‌ها...")).toBeInTheDocument();
    expect(screen.queryByText("هنوز فایلی پیوست نشده است.")).not.toBeInTheDocument();
  });
  it("shows a localized failed-read state", () => {
    query.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    render(
      <LocaleProvider locale="fa">
        <FileAttachments entityType="person" entityId="p1" />
      </LocaleProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("فایل‌ها دریافت نشدند");
    expect(screen.queryByText("هنوز فایلی پیوست نشده است.")).not.toBeInTheDocument();
  });
  it("rejects oversized synthetic files locally and keeps the filename intact", async () => {
    const file = new File([""], "report-۱۴۰۵.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: 99_999_999 });
    const error = await uploadOneFile(file, "person", "p1", "fa");
    expect(error).toContain("report-۱۴۰۵.pdf");
    expect(error).toContain("۲۵ مگابایت");
    expect(requestUpload).not.toHaveBeenCalled();
  });
});

it("surfaces a localized download failure when the action rejects", async () => {
  query.mockReturnValue({
    data: [{ id: "f1", filename: "sample.pdf", sizeBytes: 5, contentType: "application/pdf" }],
    isLoading: false,
    isError: false,
  });
  downloadAction.mockRejectedValueOnce(new Error("offline"));
  render(
    <LocaleProvider locale="fa">
      <FileAttachments entityType="person" entityId="p1" readOnly />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "دریافت sample.pdf" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("باز کردن فایل انجام نشد."),
  );
});
