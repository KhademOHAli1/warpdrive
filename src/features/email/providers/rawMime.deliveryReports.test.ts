import { describe, expect, it } from "vitest";
import { parseRawMime } from "./rawMime";

const machine = Buffer.from(
  [
    "Reporting-MTA: dns; relay.example.test",
    "",
    "Final-Recipient: utf-8; مشتری@example.test",
    "Action: failed",
    "Status: 5.1.1",
    "Diagnostic-Code: smtp; 550 نشانی پیدا نشد / Adresse nicht gefunden",
    "Localized-Diagnostic: fa; نشانی گیرنده پیدا نشد",
    "Localized-Diagnostic: de; Die Empfängeradresse wurde nicht gefunden",
    "",
  ].join("\r\n"),
);

function report(content = machine, boundary = "dsn") {
  return [
    "From: mailer-daemon@example.test",
    "To: owner@example.test",
    "Subject: Delivery report",
    "MIME-Version: 1.0",
    `Content-Type: multipart/report; report-type=global-delivery-status; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "گزارش دریافت‌شده / Empfangener Bericht",
    `--${boundary}`,
    "Content-Type: message/global-delivery-status",
    "Content-Transfer-Encoding: base64",
    "",
    content.toString("base64"),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function forwarded(child: string, boundary = "forward") {
  return [
    `Content-Type: multipart/mixed; boundary=${boundary}`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain",
    "",
    "Forwarded for review",
    `--${boundary}`,
    "Content-Type: message/rfc822",
    "Content-Disposition: attachment; filename=forwarded.eml",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(child).toString("base64"),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

const parse = (source: string | Buffer) =>
  parseRawMime({
    source: Buffer.isBuffer(source) ? source : Buffer.from(source),
    signal: AbortSignal.timeout(3000),
  });

describe("bounded transfer-decoded delivery-report MIME parts", () => {
  it("preserves native FA/DE machine bytes separately from ordinary attachments and body text", async () => {
    const result = await parse(report());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deliveryReports).toEqual([
      {
        partKey: "2",
        mediaType: "message/global-delivery-status",
        provenance: "direct",
        content: machine,
      },
    ]);
    expect(result.value.deliveryReportsTruncated).toBe(false);
    expect(result.value.attachments).toEqual([]);
    expect(result.value.text).toContain("گزارش دریافت‌شده / Empfangener Bericht");
    expect(result.value.text).not.toContain("Final-Recipient");
  });

  it("also preserves traditional ASCII delivery-status parts", async () => {
    const ascii = Buffer.from(
      "Reporting-MTA: dns; relay.example.test\r\n\r\nFinal-Recipient: rfc822; Kunde@example.test\r\nAction: failed\r\nStatus: 5.1.1\r\n",
    );
    const result = await parse(
      report(ascii).replaceAll("global-delivery-status", "delivery-status"),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        deliveryReports: [
          {
            mediaType: "message/delivery-status",
            provenance: "direct",
            content: ascii,
          },
        ],
      },
    });
  });

  it("retains malformed UTF-8 bytes for the strict machine parser to reject, without replacing text", async () => {
    const invalid = Buffer.from([0xc0, 0xaf]);
    const result = await parse(report(invalid));
    expect(result).toMatchObject({ ok: true, value: { deliveryReports: [{ content: invalid }] } });
    expect(result.ok && result.value.text).toContain("Empfangener Bericht");
  });

  it("does not upgrade a report nested inside multipart/mixed to direct provenance", async () => {
    const nested = [
      "Content-Type: multipart/mixed; boundary=outer",
      "",
      "--outer",
      "Content-Type: text/plain",
      "",
      "For review",
      "--outer",
      report(),
      "--outer--",
      "",
    ].join("\r\n");
    const result = await parse(nested);
    expect(result).toMatchObject({
      ok: true,
      value: {
        deliveryReports: [
          {
            partKey: "2.2",
            provenance: "nested",
            content: machine,
          },
        ],
      },
    });
  });

  it("marks an attached RFC822 report forwarded and retains a stable qualified part key", async () => {
    const result = await parse(forwarded(report()));
    expect(result).toMatchObject({
      ok: true,
      value: {
        deliveryReports: [
          {
            partKey: "2!2",
            provenance: "forwarded",
            content: machine,
          },
        ],
      },
    });
    expect(result.ok && result.value.attachments).toHaveLength(1);
    expect(result.ok && result.value.attachments[0]?.filename).toBe("forwarded.eml");
  });

  it("does not treat a mismatched report-type parameter as direct provenance", async () => {
    const result = await parse(
      report().replace(
        "report-type=global-delivery-status",
        "report-type=disposition-notification",
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { deliveryReports: [{ provenance: "nested" }] },
    });
  });

  it("keeps an oversized machine part from suppressing an otherwise readable message", async () => {
    const result = await parse(report(Buffer.alloc(128 * 1024 + 1, 65)));
    expect(result).toMatchObject({
      ok: true,
      value: { deliveryReports: [], deliveryReportsTruncated: true, attachments: [] },
    });
    expect(result.ok && result.value.text).toContain("Empfangener Bericht");
  });

  it("caps retained machine parts at eight while preserving the ordinary message", async () => {
    const parts = Array.from(
      { length: 9 },
      (_, index) => `--many\r\n${report(machine, `dsn${index}`)}\r\n`,
    );
    const result = await parse(
      `Content-Type: multipart/mixed; boundary=many\r\n\r\n${parts.join("")}--many--\r\n`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deliveryReports).toHaveLength(8);
    expect(result.value.deliveryReportsTruncated).toBe(true);
    expect(result.value.deliveryReports.every((part) => part.provenance === "nested")).toBe(true);
  });

  it("bounds nested RFC822 traversal rather than following an arbitrarily deep forwarded chain", async () => {
    let source = report();
    for (let index = 0; index < 5; index++) source = forwarded(source, `forward${index}`);
    const result = await parse(source);
    expect(result).toMatchObject({
      ok: true,
      value: { deliveryReports: [], deliveryReportsTruncated: true },
    });
  });

  it("does not infer reports from subject lines or sender names in ordinary email", async () => {
    const result = await parse(
      "From: Mailer Daemon <sender@example.test>\r\nSubject: Delivery failure\r\n\r\nNot a machine report.",
    );
    expect(result).toMatchObject({
      ok: true,
      value: { deliveryReports: [], deliveryReportsTruncated: false },
    });
  });

  it("preserves ordinary PDF attachments beside machine reports", async () => {
    const source = report().replace(
      "--dsn--",
      [
        "--dsn",
        "Content-Type: application/pdf",
        'Content-Disposition: attachment; filename="Angebot.pdf"',
        "Content-Transfer-Encoding: base64",
        "",
        Buffer.from("%PDF-1.7").toString("base64"),
        "--dsn--",
      ].join("\r\n"),
    );
    const result = await parse(source);
    expect(result).toMatchObject({
      ok: true,
      value: {
        deliveryReports: [{ content: machine }],
        attachments: [{ filename: "Angebot.pdf", content: Buffer.from("%PDF-1.7"), size: 8 }],
      },
    });
    expect(result.ok && result.value.attachments).toHaveLength(1);
    expect(result.ok && result.value.text).toContain("Empfangener Bericht");
  });

  it("keeps inline forwarded body behavior while privately qualifying its report as forwarded", async () => {
    const source = [
      "Content-Type: multipart/mixed; boundary=outer",
      "",
      "--outer",
      "Content-Type: text/plain",
      "",
      "Forwarded for review",
      "--outer",
      "Content-Type: message/rfc822",
      "Content-Disposition: inline",
      "",
      report(),
      "--outer--",
      "",
    ].join("\r\n");
    const result = await parse(source);
    expect(result).toMatchObject({
      ok: true,
      value: { deliveryReports: [{ partKey: "2!2", provenance: "forwarded", content: machine }] },
    });
    expect(result.ok && result.value.text).toContain("Forwarded for review");
    expect(result.ok && result.value.text).toContain("Empfangener Bericht");
    expect(result.ok && result.value.text).not.toContain("Final-Recipient");
    expect(result.ok && result.value.attachments).toHaveLength(0);
  });

  it("preserves bytes and provenance when raw UTF-8 arrives in seven-byte stream chunks", async () => {
    const bytes = Buffer.from(report());
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < bytes.length; offset += 7)
      chunks.push(bytes.subarray(offset, offset + 7));
    const result = await parseRawMime({
      source: Readable.from(chunks),
      signal: AbortSignal.timeout(3000),
    });
    expect(result).toMatchObject({
      ok: true,
      value: { deliveryReports: [{ content: machine, provenance: "direct" }], attachments: [] },
    });
  });

  it("destroys both parser branches and the owned source on mid-stream cancellation", async () => {
    const source = new PassThrough();
    const controller = new AbortController();
    const pending = parseRawMime({ source, signal: controller.signal });
    source.write(Buffer.from(report().slice(0, 200)));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(source.destroyed).toBe(true);
  });

  it("does not assign direct provenance to ambiguous duplicate container Content-Type headers", async () => {
    const source = report().replace(
      "MIME-Version: 1.0",
      "Content-Type: multipart/report; report-type=global-delivery-status; boundary=dsn\r\nMIME-Version: 1.0",
    );
    const result = await parse(source);
    expect(result).toMatchObject({
      ok: true,
      value: { deliveryReports: [{ content: machine, provenance: "nested" }] },
    });
  });
});

import { PassThrough, Readable } from "node:stream";
