import { expect, it } from "vitest";
import { mailboxEndpointInputSchema } from "./mailConnectionSchemas";

it("preserves exact Unicode credential bytes but rejects SASL separator injection", () => {
  const input = {
    host: "mail.example.test",
    port: 993,
    security: "tls",
    username: " کاربر@مثال.test ",
    password: " äß رمز عبور ",
  };
  expect(mailboxEndpointInputSchema.parse(input)).toEqual(input);
  for (const field of ["username", "password"] as const) {
    expect(
      mailboxEndpointInputSchema.safeParse({ ...input, [field]: `${input[field]}\0forged` })
        .success,
    ).toBe(false);
  }
});
