import { describe, expect, test } from "vitest";
import { parseAuthOperatorArgs } from "./operatorCommand";

describe("host auth operator argument boundary", () => {
  test("first-admin renewal requires only the unchanged recipient and explicit confirmation", () => {
    expect(
      parseAuthOperatorArgs(["resend-bootstrap", "--email", "owner@example.com", "--confirm"]),
    ).toMatchObject({
      ok: true,
      value: { command: "resend-bootstrap", email: "owner@example.com", operatorConfirmed: true },
    });
    expect(
      parseAuthOperatorArgs(["resend-bootstrap", "--email", "owner@example.com"]),
    ).toMatchObject({ ok: false });
    expect(
      parseAuthOperatorArgs([
        "resend-bootstrap",
        "--email",
        "owner@example.com",
        "--confirm",
        "--locale",
        "de",
      ]),
    ).toMatchObject({ ok: false });
    expect(
      parseAuthOperatorArgs([
        "resend-bootstrap",
        "--email",
        "owner@example.com",
        "--confirm",
        "--name",
        "Replacement",
      ]),
    ).toMatchObject({ ok: false });
  });
  test("requires an explicit confirmed command with strictly bounded options", () => {
    for (const args of [
      [],
      ["bootstrap", "--email", "owner@example.com", "--name", "Owner"],
      ["recover", "--request-id", "00000000-0000-4000-8000-000000000001"],
      ["approve", "--confirm"],
      ["bootstrap", "--confirm", "--token", "unsafe"],
      [
        "bootstrap",
        "--confirm",
        "--email",
        "a@example.com",
        "--email",
        "b@example.com",
        "--name",
        "Owner",
      ],
      ["recover", "--confirm", "--request-id", "not-a-uuid"],
      [
        "recover",
        "--confirm",
        "--request-id",
        "00000000-0000-4000-8000-000000000001",
        "--email",
        "redirect@example.com",
      ],
    ]) {
      expect(parseAuthOperatorArgs(args)).toMatchObject({ ok: false });
    }
  });
  test("parses Farsi-first bootstrap and explicit German locale without credentials", () => {
    expect(
      parseAuthOperatorArgs([
        "bootstrap",
        "--confirm",
        "--email",
        "OWNER@example.com",
        "--name",
        " Owner ",
      ]),
    ).toMatchObject({
      ok: true,
      value: {
        command: "bootstrap",
        email: "owner@example.com",
        name: "Owner",
        locale: "fa",
        operatorConfirmed: true,
      },
    });
    expect(
      parseAuthOperatorArgs([
        "bootstrap",
        "--confirm",
        "--email",
        "owner@example.com",
        "--name",
        "Owner",
        "--locale",
        "de",
      ]),
    ).toMatchObject({ ok: true, value: { locale: "de" } });
  });
  test("recovery can target only a request UUID and emergency mode must be explicit", () => {
    const base = ["recover", "--confirm", "--request-id", "00000000-0000-4000-8000-000000000001"];
    expect(parseAuthOperatorArgs(base)).toMatchObject({
      ok: true,
      value: { command: "recover", emergencyLastAdministrator: false },
    });
    expect(parseAuthOperatorArgs([...base, "--emergency-last-admin"])).toMatchObject({ ok: false });
    expect(parseAuthOperatorArgs([...base, "--confirm-ownership"])).toMatchObject({ ok: false });
    expect(
      parseAuthOperatorArgs([...base, "--emergency-last-admin", "--confirm-ownership"]),
    ).toMatchObject({
      ok: true,
      value: { emergencyLastAdministrator: true, ownershipConfirmed: true },
    });
  });
});
