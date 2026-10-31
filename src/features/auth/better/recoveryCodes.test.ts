import { describe, expect, test } from "vitest";
import { createHashedBackupCodeStorage, hashRecoveryInput } from "./recoveryCodes";

describe("hashed recovery-code storage", () => {
  test("stores only digests while the issued codes remain usable", async () => {
    const storage = createHashedBackupCodeStorage();
    const issued = ["aBcd0-12345", "Zyx90-00001"];
    const encoded = await storage.encrypt(JSON.stringify(issued));
    expect(encoded).not.toContain(issued[0]);
    expect(encoded).not.toContain(issued[1]);
    expect(JSON.parse(await storage.decrypt(encoded))).toEqual(issued.map(hashRecoveryInput));
  });

  test("does not hash stored remaining-code digests a second time", async () => {
    const storage = createHashedBackupCodeStorage();
    const original = await storage.encrypt(JSON.stringify(["first-code", "other-code"]));
    const remaining = JSON.parse(await storage.decrypt(original)) as string[];
    const reencoded = await storage.encrypt(JSON.stringify(remaining.slice(1)));
    expect(JSON.parse(await storage.decrypt(reencoded))).toEqual([hashRecoveryInput("other-code")]);
  });

  test("a leaked stored digest cannot be submitted as a recovery credential", () => {
    const digest = hashRecoveryInput("aBcd0-12345");
    expect(hashRecoveryInput(digest)).not.toBe(digest);
    expect(hashRecoveryInput("abCd0-12345")).not.toBe(digest);
  });

  test("refuses malformed recovery records instead of treating them as codes", async () => {
    const storage = createHashedBackupCodeStorage();
    await expect(storage.encrypt('{"not":"codes"}')).rejects.toThrow();
    await expect(storage.decrypt('["unhashed-code"]')).rejects.toThrow();
  });
});
