import { describe, expect, it } from "vitest";
import { chooseImapThread, imapMessageFingerprint } from "./imapThreading";

describe("IMAP reference and copy identity", () => {
  it("deduplicates identical source only within the same mailbox", () => {
    const source = Buffer.from("Message-ID: <same@example.test>\r\n\r\noriginal");
    expect(imapMessageFingerprint("account-a", source)).toBe(
      imapMessageFingerprint("account-a", source),
    );
    expect(imapMessageFingerprint("account-a", source)).not.toBe(
      imapMessageFingerprint("account-b", source),
    );
    expect(imapMessageFingerprint("account-a", source)).not.toBe(
      imapMessageFingerprint(
        "account-a",
        Buffer.from("Message-ID: <same@example.test>\r\n\r\nchanged"),
      ),
    );
  });

  it("requires account and an external participant, not just a shared owner address", () => {
    const args = {
      accountId: "account-a",
      ownAddresses: ["owner@example.test"],
      participants: ["owner@example.test", "client@example.test"],
      references: ["<old@example.test>"],
    };
    expect(
      chooseImapThread({
        ...args,
        candidates: [
          {
            accountId: "account-b",
            threadId: "other",
            rfcMessageId: "<old@example.test>",
            participants: ["client@example.test"],
          },
        ],
      }),
    ).toBeNull();
    expect(
      chooseImapThread({
        ...args,
        candidates: [
          {
            accountId: "account-a",
            threadId: "unrelated",
            rfcMessageId: "<old@example.test>",
            participants: ["owner@example.test", "other@example.test"],
          },
        ],
      }),
    ).toBeNull();
    expect(
      chooseImapThread({
        ...args,
        candidates: [
          {
            accountId: "account-a",
            threadId: "reply",
            rfcMessageId: "<old@example.test>",
            participants: ["owner@example.test", "client@example.test"],
          },
        ],
      }),
    ).toBe("reply");
  });

  it("keeps ambiguous repeated Message-IDs in separate threads", () => {
    expect(
      chooseImapThread({
        accountId: "a",
        ownAddresses: ["owner@example.test"],
        participants: ["client@example.test"],
        references: ["<repeated@example.test>"],
        candidates: ["thread-1", "thread-2"].map((threadId) => ({
          accountId: "a",
          threadId,
          rfcMessageId: "<repeated@example.test>",
          participants: ["client@example.test"],
        })),
      }),
    ).toBeNull();
  });

  it("chooses the closest unique reference and ignores unrelated references", () => {
    expect(
      chooseImapThread({
        accountId: "a",
        ownAddresses: ["owner@example.test"],
        participants: ["CLIENT@example.test"],
        references: ["<old@example.test>", "<closest@example.test>"],
        candidates: [
          {
            accountId: "a",
            threadId: "older",
            rfcMessageId: "<old@example.test>",
            participants: ["client@example.test"],
          },
          {
            accountId: "a",
            threadId: "closest",
            rfcMessageId: "<closest@example.test>",
            participants: ["client@example.test"],
          },
        ],
      }),
    ).toBe("closest");
  });
});
