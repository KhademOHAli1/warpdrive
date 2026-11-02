import { expect, it } from "vitest";
import { attachmentDownloadHeaders } from "./attachmentDownloadHeaders";

it.each(["پیشنهاد.pdf", "Angebot für Sie.pdf", "😀.pdf"])(
  "encodes a usable international download filename for %s",
  (filename) => {
    const headers = attachmentDownloadHeaders({ filename, mimeType: "application/pdf" });
    const response = new Response("synthetic", { headers });
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment; filename=");
    expect(decodeURIComponent(disposition.split("filename*=UTF-8''")[1] ?? "")).toBe(filename);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  },
);

it("removes header controls, path separators and malformed Unicode, and rejects an invalid MIME header", () => {
  const headers = attachmentDownloadHeaders({
    filename: 'quote"\r\nX-Test: bad/../\ud800.pdf',
    mimeType: "text/html\r\nX-Test: bad",
  });
  const response = new Response("synthetic", { headers });
  expect(response.headers.get("content-type")).toBe("application/octet-stream");
  expect(response.headers.get("x-test")).toBeNull();
  expect(response.headers.get("content-disposition")).not.toMatch(/[\r\n]/);
});
