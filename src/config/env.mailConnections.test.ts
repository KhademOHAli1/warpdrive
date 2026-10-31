import { expect, it } from "vitest";
import { testEnvInput } from "@/test/envInput";
import { envSchema } from "./env";

it("defaults to no privileged internal mail endpoints", () => {
  expect(envSchema.parse(testEnvInput()).MAIL_INTERNAL_ENDPOINTS).toEqual([]);
});

it("accepts exact operator endpoint grants and rejects malformed or unknown policy fields", () => {
  const entry = {
    protocol: "imaps",
    host: "mail.internal.example",
    port: 993,
    allowedAddresses: ["10.0.0.8"],
  };
  expect(
    envSchema.parse({ ...testEnvInput(), MAIL_INTERNAL_ENDPOINTS: JSON.stringify([entry]) })
      .MAIL_INTERNAL_ENDPOINTS,
  ).toEqual([entry]);
  for (const policy of [
    "not-json",
    "{}",
    JSON.stringify([{ ...entry, port: 0 }]),
    JSON.stringify([{ ...entry, unrestricted: true }]),
  ])
    expect(
      envSchema.safeParse({ ...testEnvInput(), MAIL_INTERNAL_ENDPOINTS: policy }).success,
    ).toBe(false);
});
