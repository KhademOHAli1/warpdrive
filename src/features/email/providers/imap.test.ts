import { afterEach, describe, expect, it } from "vitest";
import { startMailProtocolImap } from "@/test/mailProtocolImap";
import { createImapTransport } from "./imap";

const fixtures: Awaited<ReturnType<typeof startMailProtocolImap>>[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

async function setup(options?: Parameters<typeof startMailProtocolImap>[0]) {
  const fixture = await startMailProtocolImap(options);
  fixtures.push(fixture);
  const config = {
    endpoint: fixture.endpoint,
    username: "owner@mail.test",
    password: "synthetic-password",
  };
  return { fixture, config, transport: createImapTransport(config) };
}
const signal = () => new AbortController().signal;

describe("native IMAP transport", () => {
  it("merges split data for the requested UID and ignores unrelated flag updates", async () => {
    const { transport, fixture } = await setup();
    fixture.state.splitFetchRows = true;
    fixture.state.fetchExtraRows = 2;
    const page = await transport.readFolder({ path: "INBOX", limit: 2, signal: signal() });
    expect(page).toMatchObject({
      ok: true,
      value: {
        lastUid: 2,
        nextAfterUid: 2,
        hasMore: true,
        messages: [
          { uid: 1, flags: [] },
          { uid: 2, flags: ["\\Seen"] },
        ],
      },
    });
    const source = fixture.state.folders.get("INBOX")?.messages[0]?.source;
    expect(page.ok && page.value.messages[0]?.source).toEqual(source);
    expect(
      await transport.inspectMessages({
        path: "INBOX",
        uidValidity: "123",
        uids: [1, 4],
        signal: signal(),
      }),
    ).toEqual({ ok: true, value: { messages: [{ uid: 1, flags: [] }], missing: [4] } });
  });

  it("preserves abort while waiting inside the FETCH iterator", async () => {
    const { transport, fixture } = await setup();
    fixture.state.stallFetch = true;
    const controller = new AbortController();
    const pending = transport.getSource({
      path: "INBOX",
      uidValidity: "123",
      uid: 1,
      signal: controller.signal,
    });
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      clearTimeout(timer);
    }
  });
  it("rejects a flood of unsolicited FETCH rows while inspecting one UID", async () => {
    const { transport, fixture } = await setup();
    fixture.state.fetchExtraRows = 513;
    expect(
      await transport.inspectMessages({
        path: "INBOX",
        uidValidity: "123",
        uids: [1],
        signal: signal(),
      }),
    ).toEqual({ ok: false, error: { kind: "unsupported" } });
  });

  it.each([false, true])(
    "bounds aggregate unsolicited FETCH source bytes (STARTTLS=%s)",
    async (starttls) => {
      const { transport, fixture } = await setup({ starttls });
      fixture.state.fetchExtraSource = Buffer.alloc(17 * 1024 * 1024, 65);
      fixture.state.fetchExtraSourceCopies = 2;
      expect(
        await transport.getSource({ path: "INBOX", uidValidity: "123", uid: 1, signal: signal() }),
      ).toEqual({ ok: false, error: { kind: "unsupported" } });
    },
  );

  it("bounds session bytes even when every FETCH command fits its own budget", async () => {
    const { transport, fixture } = await setup();
    const folder = fixture.state.folders.get("INBOX");
    if (folder === undefined) throw new Error("Missing fixture folder");
    folder.messages = Array.from({ length: 20 }, (_, index) => ({
      uid: index + 1,
      flags: [],
      date: new Date("2026-10-31T12:00Z"),
      source: Buffer.alloc(1024 * 1024, 65),
    }));
    fixture.state.fetchExtraSource = Buffer.alloc(2 * 1024 * 1024, 66);
    fixture.state.fetchExtraSourceCopies = 2;
    const result = await transport.readFolder({ path: "INBOX", signal: signal() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unsupported");
  });

  it("admits 1000 folders across LIST and LSUB without confusing their row budgets", async () => {
    const { transport, fixture } = await setup();
    for (let index = 0; index < 998; index += 1)
      fixture.state.folders.set(`Folder-${index}`, {
        validity: "1",
        readOnly: false,
        messages: [],
      });
    const result = await transport.listFolders({ signal: signal() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.folders).toHaveLength(1000);
  });

  it.each([false, true])(
    "rejects an untrusted LIST TLS certificate before authentication (STARTTLS=%s)",
    async (starttls) => {
      const { config, fixture } = await setup({ starttls });
      const transport = createImapTransport({
        ...config,
        endpoint: {
          ...config.endpoint,
          tls: { rejectUnauthorized: true, minVersion: "TLSv1.2", servername: "mail.test" },
        },
      });
      expect(await transport.listFolders({ signal: signal() })).toEqual({
        ok: false,
        error: { kind: "tls" },
      });
      expect(fixture.authenticationAttempts()).toBe(0);
    },
  );

  it.each([false, true])(
    "retains the LIST socket watchdog after TLS (STARTTLS=%s)",
    async (starttls) => {
      const { config, fixture } = await setup({ starttls });
      fixture.state.stallList = true;
      const transport = createImapTransport({
        ...config,
        timeouts: { socketMs: 50, greetingMs: 500, connectionMs: 500 },
      });
      expect(await transport.listFolders({ signal: signal() })).toEqual({
        ok: false,
        error: { kind: "timeout" },
      });
    },
  );

  it("destroys a stalled LIST transport on cancellation", async () => {
    const { transport, fixture } = await setup();
    fixture.state.stallList = true;
    const controller = new AbortController();
    const listing = transport.listFolders({ signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await expect(listing).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      clearTimeout(timer);
    }
  });
  it.each([false, true])(
    "rejects excessive LIST folder counts before SDK accumulation (STARTTLS=%s)",
    async (starttls) => {
      const { transport, fixture } = await setup({ starttls });
      for (let index = 0; index < 1001; index += 1)
        fixture.state.folders.set(`Folder-${index}`, {
          validity: "1",
          readOnly: false,
          messages: [],
        });
      expect(await transport.listFolders({ signal: signal() })).toEqual({
        ok: false,
        error: { kind: "unsupported" },
      });
    },
  );

  it("bounds cumulative LIST bytes across otherwise allowed folder responses", async () => {
    const { transport, fixture } = await setup();
    for (let index = 0; index < 150; index += 1)
      fixture.state.folders.set(`${index}-${"x".repeat(32 * 1024)}`, {
        validity: "1",
        readOnly: false,
        messages: [],
      });
    expect(await transport.listFolders({ signal: signal() })).toEqual({
      ok: false,
      error: { kind: "unsupported" },
    });
  });

  it("reconciles flags and disappeared UIDs without reading message bodies", async () => {
    const { transport, fixture } = await setup();
    const first = fixture.state.folders.get("INBOX")?.messages[0];
    if (first === undefined) throw new Error("missing fixture message");
    first.flags = ["\\Seen"];
    expect(
      await transport.inspectMessages({
        path: "INBOX",
        uidValidity: "123",
        uids: [1, 4],
        signal: signal(),
      }),
    ).toEqual({
      ok: true,
      value: { messages: [{ uid: 1, flags: ["\\Seen"] }], missing: [4] },
    });
    expect(fixture.state.sourceFetches).toBe(0);
    expect(
      await transport.inspectMessages({
        path: "INBOX",
        uidValidity: "old",
        uids: [1],
        signal: signal(),
      }),
    ).toEqual({ ok: false, error: { kind: "uidvalidity_changed" } });
  });

  it.each([false, true])(
    "inspects folder mode without fetching content (readonly=%s)",
    async (readOnly) => {
      const { transport, fixture } = await setup({ readOnly });
      expect(await transport.inspectFolder({ path: "INBOX", signal: signal() })).toEqual({
        ok: true,
        value: { uidValidity: "123", uidNext: 4, readOnly, messageCount: 3 },
      });
      expect(fixture.state.sourceFetches).toBe(0);
      expect(fixture.state.commands).not.toContain("FETCH");
    },
  );

  it("distinguishes authoritative Sent flags from a guessed folder name", async () => {
    const { transport, fixture } = await setup();
    expect(await transport.listFolders({ signal: signal() })).toMatchObject({
      ok: true,
      value: { folders: [{ path: "INBOX" }, { path: "Sent", authoritativeSpecialUse: true }] },
    });
    const sent = fixture.state.folders.get("Sent");
    if (sent === undefined) throw new Error("Missing Sent fixture");
    sent.specialUse = null;
    expect(await transport.listFolders({ signal: signal() })).toMatchObject({
      ok: true,
      value: { folders: [{ path: "INBOX" }, { path: "Sent", authoritativeSpecialUse: false }] },
    });
  });

  it.each([false, true])(
    "verifies and discovers Inbox/Sent over TLS (STARTTLS=%s)",
    async (starttls) => {
      const { transport } = await setup({ starttls });
      const verified = await transport.verify({ signal: signal() });
      expect(verified).toMatchObject({ ok: true });
      const folders = await transport.listFolders({ signal: signal() });
      expect(folders).toMatchObject({
        ok: true,
        value: {
          folders: [{ path: "INBOX" }, { path: "Sent", specialUse: "\\Sent" }],
          canMove: true,
        },
      });
    },
  );

  it("returns bounded pages with mailbox-scoped immutable identity and a precise cursor", async () => {
    const { transport } = await setup();
    const first = await transport.readFolder({ path: "INBOX", limit: 2, signal: signal() });
    expect(first).toMatchObject({
      ok: true,
      value: {
        uidValidity: "123",
        uidNext: 4,
        readOnly: false,
        lastUid: 2,
        nextAfterUid: 2,
        hasMore: true,
        messages: [{ uid: 1 }, { uid: 2 }],
      },
    });
    const second = await transport.readFolder({
      path: "INBOX",
      afterUid: 2,
      limit: 2,
      signal: signal(),
    });
    expect(second).toMatchObject({
      ok: true,
      value: { lastUid: 3, nextAfterUid: null, hasMore: false, messages: [{ uid: 3 }] },
    });
    const beyond = await transport.readFolder({ path: "INBOX", afterUid: 100, signal: signal() });
    expect(beyond).toMatchObject({
      ok: true,
      value: { messages: [], lastUid: 100, hasMore: false },
    });
  });

  it("bounds SEARCH results while advancing through old or sparse UID ranges", async () => {
    const { transport, fixture } = await setup();
    const inbox = fixture.state.folders.get("INBOX");
    const recent = inbox?.messages[2];
    if (inbox === undefined || recent === undefined) throw new Error("Missing fixture message");
    inbox.messages = [
      { ...recent, uid: 1, date: new Date("2020-01-01T00:00Z") },
      { ...recent, uid: 5000 },
    ];
    const since = new Date("2026-09-01T00:00Z");
    expect(await transport.readFolder({ path: "INBOX", since, signal: signal() })).toMatchObject({
      ok: true,
      value: { messages: [], skipped: [], lastUid: 4096, nextAfterUid: 4096, hasMore: true },
    });
    expect(fixture.state.sourceFetches).toBe(0);
    expect(
      await transport.readFolder({ path: "INBOX", since, afterUid: 4096, signal: signal() }),
    ).toMatchObject({
      ok: true,
      value: { messages: [{ uid: 5000 }], lastUid: 5000, nextAfterUid: null, hasMore: false },
    });
  });

  it("applies the chosen history date without importing earlier mail", async () => {
    const { transport } = await setup();
    const result = await transport.readFolder({
      path: "INBOX",
      since: new Date("2026-10-01T00:00Z"),
      signal: signal(),
    });
    expect(result.ok && result.value.messages.map((message) => message.uid)).toEqual([2, 3]);
  });

  it("rejects old UIDVALIDITY before retrieving attachment source", async () => {
    const { transport, fixture } = await setup();
    const result = await transport.getSource({
      path: "INBOX",
      uid: 1,
      uidValidity: "old",
      signal: signal(),
    });
    expect(result).toEqual({ ok: false, error: { kind: "uidvalidity_changed" } });
    expect(fixture.state.sourceFetches).toBe(0);
  });

  it("retrieves source only for the requested UID and validity", async () => {
    const { transport } = await setup();
    const result = await transport.getSource({
      path: "INBOX",
      uid: 2,
      uidValidity: "123",
      signal: signal(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toString()).toContain("<message-2@mail.test>");
  });

  it("skips an advertised oversized message without downloading its body", async () => {
    const { transport, fixture } = await setup();
    const first = fixture.state.folders.get("INBOX")?.messages[0];
    if (first === undefined) throw new Error("missing fixture message");
    first.advertisedSize = 30 * 1024 * 1024;
    const result = await transport.readFolder({ path: "INBOX", limit: 1, signal: signal() });
    expect(result).toMatchObject({
      ok: true,
      value: {
        messages: [],
        lastUid: 1,
        nextAfterUid: 1,
        skipped: [{ uid: 1, reason: "message_too_large" }],
      },
    });
    expect(fixture.state.sourceFetches).toBe(0);
  });

  it("syncs read-only folders while refusing remote writes", async () => {
    const { transport, fixture } = await setup({ readOnly: true });
    expect(await transport.readFolder({ path: "INBOX", signal: signal() })).toMatchObject({
      ok: true,
      value: { readOnly: true },
    });
    expect(
      await transport.setFlags({
        path: "INBOX",
        uidValidity: "123",
        uids: [1],
        flags: ["\\Seen"],
        mode: "add",
        signal: signal(),
      }),
    ).toEqual({ ok: false, error: { kind: "read_only" } });
    expect(fixture.state.commands).not.toContain("STORE");
  });

  it("changes flags and moves only the selected UID", async () => {
    const { transport, fixture } = await setup();
    expect(
      await transport.setFlags({
        path: "INBOX",
        uidValidity: "123",
        uids: [1],
        flags: ["\\Seen"],
        mode: "add",
        signal: signal(),
      }),
    ).toEqual({ ok: true, value: true });
    expect(fixture.state.folders.get("INBOX")?.messages[0]?.flags).toContain("\\Seen");
    expect(
      await transport.moveMessages({
        path: "INBOX",
        uidValidity: "123",
        uids: [1],
        destination: "Sent",
        signal: signal(),
      }),
    ).toMatchObject({ ok: true });
    expect(fixture.state.folders.get("INBOX")?.messages.map((message) => message.uid)).toEqual([
      2, 3,
    ]);
    expect(fixture.state.folders.get("Sent")?.messages).toHaveLength(1);
  });

  it("does not fall back to unsafe expunge when MOVE is unavailable", async () => {
    const { transport } = await setup({ move: false });
    expect(
      await transport.moveMessages({
        path: "INBOX",
        uidValidity: "123",
        uids: [1],
        destination: "Sent",
        signal: signal(),
      }),
    ).toEqual({ ok: false, error: { kind: "unsupported" } });
  });

  it.each(["flags", "move"] as const)(
    "fences %s after authentication and before remote mutation",
    async (kind) => {
      const { transport, fixture } = await setup();
      let authenticated = false;
      const common = {
        path: "INBOX",
        uidValidity: "123",
        uids: [1],
        signal: signal(),
        beforeMutation: () => {
          authenticated = fixture.authenticationAttempts() === 1;
          return Promise.resolve(false);
        },
      };
      const result =
        kind === "flags"
          ? await transport.setFlags({ ...common, flags: ["\\Seen"], mode: "add" })
          : await transport.moveMessages({ ...common, destination: "Sent" });
      expect(authenticated).toBe(true);
      expect(result).toEqual({ ok: false, error: { kind: "connection_changed" } });
      expect(fixture.state.commands).not.toContain(kind === "flags" ? "STORE" : "MOVE");
    },
  );

  it("returns only authoritative COPYUID destination identities", async () => {
    const { transport } = await setup();
    expect(
      await transport.moveMessages({
        path: "INBOX",
        uidValidity: "123",
        uids: [1, 2],
        destination: "Sent",
        signal: signal(),
      }),
    ).toEqual({
      ok: true,
      value: {
        path: "Sent",
        uidValidity: "456",
        uidMap: [
          { sourceUid: 1, destinationUid: 1 },
          { sourceUid: 2, destinationUid: 2 },
        ],
      },
    });
  });

  it("appends a Sent copy with the provider UID result", async () => {
    const { transport, fixture } = await setup();
    const source = fixture.state.folders.get("INBOX")?.messages[0]?.source;
    if (source === undefined) throw new Error("missing fixture source");
    expect(await transport.appendSent({ path: "Sent", source, signal: signal() })).toMatchObject({
      ok: true,
      value: { uid: 1, uidValidity: "456" },
    });
  });

  it.each(["STORE", "MOVE"] as const)("keeps a lost %s acknowledgment unknown", async (command) => {
    const { transport, fixture } = await setup();
    fixture.state.dropMutationResponse = command;
    const common = { path: "INBOX", uidValidity: "123", uids: [1], signal: signal() };
    const result =
      command === "STORE"
        ? await transport.setFlags({ ...common, flags: ["\\Seen"], mode: "add" })
        : await transport.moveMessages({ ...common, destination: "Sent" });
    expect(result).toEqual({ ok: false, error: { kind: "mutation_unknown" } });
  });

  it("fences a changed connection after authentication before writing a Sent copy", async () => {
    const { transport, fixture } = await setup();
    let authenticatedAtFence = false;
    const result = await transport.appendSent({
      path: "Sent",
      source: Buffer.from("Subject: synthetic\r\n\r\nbody"),
      signal: signal(),
      beforeAppend: () => {
        authenticatedAtFence = fixture.authenticationAttempts() === 1;
        return Promise.resolve(false);
      },
    });
    expect(authenticatedAtFence).toBe(true);
    expect(result).toEqual({ ok: false, error: { kind: "connection_changed" } });
    expect(fixture.state.folders.get("Sent")?.messages).toHaveLength(0);
  });

  it("aborts a Sent fence without appending any bytes", async () => {
    const { transport, fixture } = await setup();
    const controller = new AbortController();
    await expect(
      transport.appendSent({
        path: "Sent",
        source: Buffer.from("Subject: synthetic\r\n\r\nbody"),
        signal: controller.signal,
        beforeAppend: () => {
          controller.abort();
          return Promise.resolve(true);
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.state.folders.get("Sent")?.messages).toHaveLength(0);
  });

  it("rejects bad credentials without returning their values", async () => {
    const { config } = await setup();
    const result = await createImapTransport({ ...config, password: "wrong-secret" }).verify({
      signal: signal(),
    });
    expect(result).toEqual({ ok: false, error: { kind: "authentication" } });
  });

  it("requires STARTTLS before authentication", async () => {
    const { transport, fixture } = await setup({ starttls: true, missingStarttls: true });
    expect(await transport.verify({ signal: signal() })).toMatchObject({
      ok: false,
      error: { kind: "tls" },
    });
    expect(fixture.authenticationAttempts()).toBe(0);
    expect(await transport.listFolders({ signal: signal() })).toMatchObject({
      ok: false,
      error: { kind: "tls" },
    });
    expect(fixture.authenticationAttempts()).toBe(0);
  });

  it("preserves cancellation during a stalled SELECT", async () => {
    const { transport } = await setup({ stallSelect: true });
    const controller = new AbortController();
    const reading = transport.readFolder({ path: "INBOX", signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      clearTimeout(timer);
    }
  });

  it("bounds actual batch bytes when the server underreports message sizes", async () => {
    const { transport, fixture } = await setup();
    const messages = fixture.state.folders.get("INBOX")?.messages;
    if (messages === undefined) throw new Error("missing fixture messages");
    for (const message of messages) {
      message.source = Buffer.alloc(17 * 1024 * 1024, 65);
      message.advertisedSize = 1;
    }
    const result = await transport.readFolder({ path: "INBOX", signal: signal() });
    expect(result).toMatchObject({
      ok: true,
      value: { lastUid: 1, nextAfterUid: 1, hasMore: true },
    });
    expect(result.ok && result.value.messages).toHaveLength(1);
  });
});
