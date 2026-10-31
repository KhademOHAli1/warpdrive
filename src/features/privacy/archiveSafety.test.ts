import { expect, test } from "vitest";
import {
  buildPrivacyArchivePath,
  escapePrivacyCsvCell,
  validatePrivacyArchivePaths,
} from "./archiveSafety";

const RECORD_ID = "5ac2f038-99a1-49a5-b97d-9ed8bf59c481";
const attachment = (filename: string) => ({
  directory: "attachments",
  recordId: RECORD_ID,
  filename,
});

test("P08B/C07: fixed opaque paths preserve legible Farsi and German names", () => {
  for (const filename of ["گزارش حریم‌خصوصی.pdf", "Erklärung über Daten.csv"])
    expect(buildPrivacyArchivePath(attachment(filename))).toEqual({
      ok: true,
      value: `attachments/${RECORD_ID}/${filename}`,
    });
  expect(buildPrivacyArchivePath(attachment("cafe\u0301.csv"))).toEqual({
    ok: true,
    value: `attachments/${RECORD_ID}/café.csv`,
  });
});

test.each([
  "../private.csv",
  "/etc/passwd",
  "C:\\private.csv",
  "\\\\server\\share.csv",
  "subdir/file.csv",
  "subdir\\file.csv",
  ".",
  "..",
  ".hidden",
  "name%2fsecret",
  "name%5csecret",
  "name%252fsecret",
  "a\u0000b.csv",
  "a\nb.csv",
  "a\tb.csv",
  "a\u202Egpj.exe",
  "a\u2066b.pdf",
  "a\u061Cb.pdf",
  "a\u200Eb.pdf",
  "a\u200Fb.pdf",
  "a\u2028b.pdf",
  "a\uD800b.pdf",
  "a\uDC00b.pdf",
  "a/b.pdf",
  "a\uFF0Fb.pdf",
  "a\uFF3Cb.pdf",
  "name:stream",
  "name\uFF1Astream",
  "CON.txt",
  "con .txt",
  "AUX",
  "COM¹.csv",
  "LPT9.txt",
  "name.",
  " name.csv",
  "name.csv ",
  "a".repeat(241),
])("P08B/C10: archive filename %j is rejected instead of rewritten", (filename) => {
  expect(buildPrivacyArchivePath(attachment(filename))).toEqual({
    ok: false,
    error: "invalid_archive_path",
  });
});

test("P08B/C10: caller-controlled namespaces and non-opaque identifiers cannot form paths", () => {
  for (const input of [
    { ...attachment("safe.csv"), directory: "../attachments" },
    { ...attachment("safe.csv"), directory: "unreviewed" },
    { ...attachment("safe.csv"), recordId: "subject@example.test" },
    { ...attachment("safe.csv"), sourcePath: "../private.csv" },
    null,
  ])
    expect(buildPrivacyArchivePath(input)).toEqual({ ok: false, error: "invalid_archive_path" });
});

test.each(["CONIN$", "conin$", "ConIn$.txt", "CONOUT$", "conout$", "ConOut$.csv"])(
  "P08B/C10: Windows console device %j cannot become an archive entry",
  (filename) => {
    expect(buildPrivacyArchivePath(attachment(filename))).toEqual({
      ok: false,
      error: "invalid_archive_path",
    });
    expect(validatePrivacyArchivePaths([`attachments/${RECORD_ID}/${filename}`])).toEqual({
      ok: false,
      error: "invalid_archive_path",
    });
  },
);

test("P08B/C10: batch validation rejects absolute paths, encoded separators and extraction collisions", () => {
  const path = (filename: string) => `attachments/${RECORD_ID}/${filename}`;
  for (const paths of [
    [path("report.csv"), path("REPORT.csv")],
    [path("café.csv"), path("cafe\u0301.csv")],
    [path("Straße.csv"), path("STRASSE.csv")],
    [path("Ａ.csv"), path("A.csv")],
    [path("safe.csv"), path("safe.csv")],
  ])
    expect(validatePrivacyArchivePaths(paths)).toEqual({
      ok: false,
      error: "archive_path_collision",
    });
  for (const paths of [
    ["/etc/passwd"],
    [path("sub%2ffile.csv")],
    ["../private.csv"],
    ["manifest.json"],
    Array.from({ length: 10001 }, () => path("safe.csv")),
  ])
    expect(validatePrivacyArchivePaths(paths)).toEqual({
      ok: false,
      error: "invalid_archive_path",
    });
  expect(validatePrivacyArchivePaths([path("گزارش.pdf"), path("Erklärung.pdf")])).toEqual({
    ok: true,
    value: [path("گزارش.pdf"), path("Erklärung.pdf")],
  });
});

test.each([
  "=1+1",
  "+1",
  "-49",
  "@SUM(A1)",
  " =1",
  "\t=1",
  "\r\n=1",
  "\uFEFF=1",
  "\u200B=1",
  "\u202E=1",
  "\u200C=1",
])("P08B/C10: CSV formula %j is quoted and neutralized", (input) => {
  expect(escapePrivacyCsvCell(input)).toEqual({ ok: true, value: `"'${input}"` });
});

test("P08B/C07: CSV preserves Unicode, quoted delimiters and ordinary line breaks", () => {
  expect(escapePrivacyCsvCell('حریم‌خصوصی، Erklärung "über"\nDaten')).toEqual({
    ok: true,
    value: '"حریم‌خصوصی، Erklärung ""über""\nDaten"',
  });
  expect(escapePrivacyCsvCell("ordinary@example.test")).toEqual({
    ok: true,
    value: '"ordinary@example.test"',
  });
  expect(escapePrivacyCsvCell("")).toEqual({ ok: true, value: '""' });
});

test("P08B/C10: CSV rejects malformed text and controls without leaking their content", () => {
  for (const value of ["\u0000=1", "\u0001=1", "\u007F=1", "\u0085=1", "\uD800", {}, null, 42])
    expect(escapePrivacyCsvCell(value)).toEqual({ ok: false, error: "invalid_csv_cell" });
});
