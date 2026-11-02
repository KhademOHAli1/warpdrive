import { afterEach, expect, it, vi } from "vitest";
import {
  checkMailboxConnection,
  listMailboxConnections,
  mutateMailboxConnection,
  saveMailboxConnection,
} from "./api";
import type { CheckMailboxInput } from "./types";

const { csrf } = vi.hoisted((): { csrf: { value: string | null } } => ({
  csrf: { value: "current-csrf" },
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => csrf.value }));
const capabilities = { read: true, send: true, markRead: true, move: false, trash: false };
const view = {
  id: "account",
  provider: "imap_smtp",
  emailAddress: "sales@example.com",
  status: "connected",
  isDefault: true,
  lastSyncAtIso: null,
  capabilities,
};
const checked = {
  checkId: "opaque-proof",
  mailboxAddress: "sales@example.com",
  capabilities,
  folders: [{ path: "INBOX", name: "Inbox", role: "inbox", readOnly: true }],
};
const endpoint = {
  host: "mail.example.com",
  port: 993,
  security: "tls" as const,
  username: " exact-user ",
  password: " exact-password ",
};
const input: CheckMailboxInput = {
  emailAddress: "sales@example.com",
  imap: endpoint,
  smtp: { ...endpoint, port: 465 },
};
function response(body: unknown, status = 200) {
  const request = vi.fn().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal("fetch", request);
  return request;
}
afterEach(() => {
  vi.unstubAllGlobals();
  csrf.value = "current-csrf";
});

it("posts credential bytes only to the fixed same-origin check endpoint with current CSRF and cancellation", async () => {
  const request = response({ ok: true, value: checked });
  const signal = new AbortController().signal;
  expect(await checkMailboxConnection(input, signal)).toEqual({ ok: true, value: checked });
  expect(request).toHaveBeenCalledWith(
    "/api/mail-connections/check",
    expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "current-csrf" },
      body: JSON.stringify(input),
    }),
  );
});

it("saves only the checked scope and validates the returned safe mailbox view", async () => {
  const request = response({ ok: true, value: { ...view, credentials: "never expose" } });
  const value = {
    checkId: "opaque-proof",
    folderPaths: ["INBOX"],
    historyDays: 90,
    isDefault: true,
  };
  expect(await saveMailboxConnection(value, new AbortController().signal)).toEqual({
    ok: true,
    value: view,
  });
  expect(request).toHaveBeenCalledWith(
    "/api/mail-connections/save",
    expect.objectContaining({ body: JSON.stringify(value) }),
  );
});

it("mutates one explicit account and accepts an omitted JSON value for void success", async () => {
  const request = response({ ok: true });
  expect(await mutateMailboxConnection("account", "pause", new AbortController().signal)).toEqual({
    ok: true,
    value: undefined,
  });
  expect(request).toHaveBeenCalledWith(
    "/api/mail-connections/mutate",
    expect.objectContaining({ body: JSON.stringify({ accountId: "account", action: "pause" }) }),
  );
});

it("does not send credential mutations without a CSRF token", async () => {
  csrf.value = null;
  const request = response({ ok: true, value: checked });
  expect(await checkMailboxConnection(input, new AbortController().signal)).toEqual({
    ok: false,
    error: "permission",
  });
  expect(request).not.toHaveBeenCalled();
});

it("retains only the finite error contract and strips provider diagnostics", async () => {
  response({ ok: false, error: "fresh_auth_required", details: "secret diagnostic" }, 403);
  expect(await checkMailboxConnection(input, new AbortController().signal)).toEqual({
    ok: false,
    error: "fresh_auth_required",
  });
});

it("does not expose unexpected server error strings", async () => {
  response({ ok: false, error: "password=secret diagnostic" }, 500);
  expect(await checkMailboxConnection(input, new AbortController().signal)).toEqual({
    ok: false,
    error: "unknown",
  });
});

it("rejects malformed capability data instead of enabling unsupported UI actions", async () => {
  response({ ok: true, value: { ...checked, capabilities: { ...capabilities, trash: "yes" } } });
  expect(await checkMailboxConnection(input, new AbortController().signal)).toEqual({
    ok: false,
    error: "unknown",
  });
});

it("rejects an HTTP failure disguised as a successful result", async () => {
  response({ ok: true, value: checked }, 500);
  expect(await checkMailboxConnection(input, new AbortController().signal)).toEqual({
    ok: false,
    error: "unknown",
  });
});

it("recovers non-JSON throttling without leaking response bodies", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("private upstream HTML", { status: 429 })),
  );
  expect(await checkMailboxConnection(input, new AbortController().signal)).toEqual({
    ok: false,
    error: "rate_limit",
  });
});

it("classifies transport failure while withholding exception text", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("secret transport URL")));
  expect(await checkMailboxConnection(input, new AbortController().signal)).toEqual({
    ok: false,
    error: "network",
  });
});

it("propagates cancellation without attempting a request", async () => {
  const request = response({ ok: true, value: checked });
  const controller = new AbortController();
  controller.abort();
  await expect(checkMailboxConnection(input, controller.signal)).rejects.toHaveProperty(
    "name",
    "AbortError",
  );
  expect(request).not.toHaveBeenCalled();
});

it("refreshes the actor's mailbox list without a mutation token and discards unknown fields", async () => {
  csrf.value = null;
  const request = response({ ok: true, value: [{ ...view, credentials: "not a view field" }] });
  expect(await listMailboxConnections(new AbortController().signal)).toEqual({
    ok: true,
    value: [view],
  });
  expect(request).toHaveBeenCalledWith(
    "/api/mail-connections/list",
    expect.objectContaining({ method: "GET", credentials: "same-origin" }),
  );
});

it("keeps reconnect endpoint metadata while removing nested passwords from the client view", async () => {
  const metadata = {
    host: "mail.example.com",
    port: 993,
    security: "tls",
    username: " exact-user ",
  };
  response({
    ok: true,
    value: [
      {
        ...view,
        historyDays: 365,
        folderPaths: ["INBOX"],
        sentCopyMode: "append",
        sentFolderPath: "Sent",
        configuration: {
          imap: { ...metadata, password: "not a view field" },
          smtp: { ...metadata, password: "not a view field" },
        },
      },
    ],
  });
  expect(await listMailboxConnections(new AbortController().signal)).toEqual({
    ok: true,
    value: [
      {
        ...view,
        historyDays: 365,
        folderPaths: ["INBOX"],
        sentCopyMode: "append",
        sentFolderPath: "Sent",
        configuration: { imap: metadata, smtp: metadata },
      },
    ],
  });
});
