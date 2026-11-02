import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildMime } from "../mime";
import { parseRawMime } from "./rawMime";

const signal = () => new AbortController().signal;

function fixture(language: "fa" | "de") {
  const subject = language === "fa" ? "پیشنهاد همکاری" : "Angebot für Ihr Unternehmen";
  const filename = language === "fa" ? "پیشنهاد.pdf" : "Übersicht.pdf";
  return {
    subject,
    filename,
    raw: Buffer.from(
      buildMime({
        from: "sender@example.test",
        to: ["recipient@example.test"],
        cc: ["copy@example.test"],
        subject,
        messageId: "<stable@example.test>",
        inReplyTo: "<previous@example.test>",
        references: "<first@example.test> <previous@example.test>",
        text: subject,
        html: `<p>${subject}</p><script>alert(1)</script><img src="https://tracker.test/pixel">`,
        attachments: [{ filename, contentType: "application/pdf", bytes: Buffer.from("%PDF-1.7") }],
      }),
    ),
  };
}

describe("bounded raw MIME parsing", () => {
  it("rejects a flood of non-attachment MIME parts", async () => {
    const parts = Array.from(
      { length: 129 },
      () => "--parts\r\nContent-Type: text/plain\r\n\r\nx\r\n",
    );
    const result = await parseRawMime({
      source: Buffer.from(
        `Content-Type: multipart/mixed; boundary=parts\r\n\r\n${parts.join("")}--parts--\r\n`,
      ),
      signal: signal(),
    });
    expect(result).toEqual({ ok: false, error: { kind: "invalid_message" } });
  });

  it("bounds every nested MIME part header, not only the message header", async () => {
    const result = await parseRawMime({
      source: Buffer.from(
        `Content-Type: multipart/mixed; boundary=parts\r\n\r\n--parts\r\nContent-Type: text/plain\r\nX-Large: ${"x".repeat(70 * 1024)}\r\n\r\nx\r\n--parts--\r\n`,
      ),
      signal: signal(),
    });
    expect(result).toEqual({ ok: false, error: { kind: "invalid_message" } });
  });

  it("extracts only a unique valid top-level send-attempt hint, never proof of authorship", async () => {
    const id = "7f849044-6f72-4d27-8cac-f35980a1ce01";
    const base = fixture("de").raw.toString();
    const one = await parseRawMime({
      source: Buffer.from(`X-Warpdrive-Send-Attempt: ${id}\r\n${base}`),
      signal: signal(),
    });
    expect(one.ok && one.value.warpdriveSendAttemptId).toBe(id);
    const duplicate = await parseRawMime({
      source: Buffer.from(
        `X-Warpdrive-Send-Attempt: ${id}\r\nX-Warpdrive-Send-Attempt: ${id}\r\n${base}`,
      ),
      signal: signal(),
    });
    expect(duplicate.ok && duplicate.value.warpdriveSendAttemptId).toBeNull();
    const malformed = await parseRawMime({
      source: Buffer.from(`X-Warpdrive-Send-Attempt: not-an-id\r\n${base}`),
      signal: signal(),
    });
    expect(malformed.ok && malformed.value.warpdriveSendAttemptId).toBeNull();
  });

  it.each(["fa", "de"] as const)(
    "decodes %s headers, body and attachment names",
    async (language) => {
      const sample = fixture(language);
      const result = await parseRawMime({ source: sample.raw, signal: signal() });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.subject).toBe(sample.subject);
      expect(result.value.from).toEqual([{ email: "sender@example.test", name: null }]);
      expect(result.value.to).toEqual([{ email: "recipient@example.test", name: null }]);
      expect(result.value.cc).toEqual([{ email: "copy@example.test", name: null }]);
      expect(result.value.text?.trim()).toBe(sample.subject);
      expect(result.value.html).toContain(sample.subject);
      expect(result.value.html).not.toContain("script");
      expect(result.value.html).not.toContain("tracker.test");
      expect(result.value.htmlWithRemoteImages).toContain("https://tracker.test/pixel");
      expect(result.value.htmlWithRemoteImages).not.toContain("script");
      expect(result.value.rfcMessageId).toBe("<stable@example.test>");
      expect(result.value.inReplyTo).toBe("<previous@example.test>");
      expect(result.value.references).toEqual(["<first@example.test>", "<previous@example.test>"]);
      expect(result.value.attachments).toHaveLength(1);
      expect(result.value.attachments[0]).toMatchObject({
        partKey: "2",
        filename: sample.filename,
        contentType: "application/pdf",
        size: 8,
        content: Buffer.from("%PDF-1.7"),
      });
    },
  );

  it("bounds a stream before it can be fully consumed", async () => {
    let consumed = 0;
    const source = Readable.from(
      (function* () {
        for (let i = 0; i < 100; i += 1) {
          consumed += 1;
          yield Buffer.alloc(4096, 65);
        }
      })(),
      { highWaterMark: 1 },
    );
    const result = await parseRawMime({ source, limits: { messageBytes: 8192 }, signal: signal() });
    expect(result).toEqual({ ok: false, error: { kind: "message_too_large" } });
    expect(consumed).toBeLessThan(100);
    expect(source.destroyed).toBe(true);
  });

  it("rejects oversized attachments without returning their bytes", async () => {
    const result = await parseRawMime({
      source: fixture("fa").raw,
      limits: { attachmentBytes: 4 },
      signal: signal(),
    });
    expect(result).toEqual({ ok: false, error: { kind: "attachment_too_large" } });
  });

  it("rejects excessive body and header sizes", async () => {
    const body = await parseRawMime({
      source: Buffer.from(`From: a@example.test\r\n\r\n${"x".repeat(100)}`),
      limits: { bodyBytes: 20 },
      signal: signal(),
    });
    expect(body).toEqual({ ok: false, error: { kind: "body_too_large" } });
    const header = await parseRawMime({
      source: Buffer.from(`Subject: ${"x".repeat(100)}\r\n\r\nbody`),
      limits: { headerBytes: 30 },
      signal: signal(),
    });
    expect(header).toEqual({ ok: false, error: { kind: "headers_too_large" } });
  });

  it("preserves abort as AbortError and destroys the source", async () => {
    const controller = new AbortController();
    const source = new Readable({ read() {} });
    const parsing = parseRawMime({ source, signal: controller.signal });
    controller.abort();
    await expect(parsing).rejects.toMatchObject({ name: "AbortError" });
    expect(source.destroyed).toBe(true);
  });

  it("destroys an already aborted input stream without starting parsing", async () => {
    const controller = new AbortController();
    controller.abort();
    const source = new Readable({ read() {} });
    await expect(parseRawMime({ source, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(source.destroyed).toBe(true);
  });

  it("keeps distinct stable part identifiers for identical attachment filenames", async () => {
    const raw = Buffer.from(
      buildMime({
        from: "a@example.test",
        to: ["b@example.test"],
        subject: "attachments",
        html: "<p>body</p>",
        messageId: "<parts@example.test>",
        attachments: [
          { filename: "same.txt", contentType: "text/plain", bytes: Buffer.from("first") },
          { filename: "same.txt", contentType: "text/plain", bytes: Buffer.from("second") },
        ],
      }),
    );
    const result = await parseRawMime({ source: raw, signal: signal() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.attachments.map((part) => part.partKey)).toEqual(["2", "3"]);
    expect(result.value.attachments.map((part) => part.content.toString())).toEqual([
      "first",
      "second",
    ]);
  });
});
