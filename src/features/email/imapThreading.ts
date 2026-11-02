import { createHash } from "node:crypto";

export function imapMessageFingerprint(accountId: string, source: Buffer): string {
  return createHash("sha256").update(accountId).update("\0").update(source).digest("hex");
}

interface ThreadCandidate {
  accountId: string;
  threadId: string;
  rfcMessageId: string;
  participants: string[];
}

export function chooseImapThread(args: {
  accountId: string;
  ownAddresses: string[];
  participants: string[];
  references: string[];
  candidates: ThreadCandidate[];
}): string | null {
  const own = new Set(args.ownAddresses.map((address) => address.toLowerCase()));
  const external = new Set(
    args.participants
      .map((address) => address.toLowerCase())
      .filter((address) => !own.has(address)),
  );
  for (const reference of [...args.references].reverse()) {
    const matching = args.candidates.filter(
      (candidate) =>
        candidate.accountId === args.accountId &&
        candidate.rfcMessageId === reference &&
        candidate.participants.some((address) => external.has(address.toLowerCase())),
    );
    const threads = new Set(matching.map((candidate) => candidate.threadId));
    if (threads.size > 1) return null;
    const [threadId] = threads;
    if (threadId !== undefined) return threadId;
  }
  return null;
}
