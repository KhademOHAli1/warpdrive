import { afterEach, expect, it, vi } from "vitest";
import { createGmailClient } from "./gmailClient";

afterEach(() => vi.unstubAllGlobals());
it("reconciles only Sent messages rather than adopting an inbound matching Message-ID", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ messages: [] })));
  vi.stubGlobal("fetch", request);
  await createGmailClient("synthetic-access-token").searchByRfc822({
    messageIdHeader: "<attempt@mail.test>",
    signal: AbortSignal.timeout(5000),
  });
  const argument = request.mock.calls[0]?.[0];
  const requestUrl =
    argument instanceof Request ? argument.url : argument instanceof URL ? argument.href : argument;
  const url = new URL(requestUrl ?? "https://missing-request.invalid");
  expect(url.searchParams.get("q")).toBe("in:sent rfc822msgid:<attempt@mail.test>");
});
it("does not carry raw provider message bodies into errors on malformed responses", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ body: "synthetic-private-message-body" }))),
  );
  const result = await createGmailClient("synthetic-access-token").getMessage({
    id: "message",
    signal: AbortSignal.timeout(5000),
  });
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain("synthetic-private-message-body");
});
