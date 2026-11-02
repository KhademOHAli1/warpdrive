import { once } from "node:events";
import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { createImapTransport } from "@/features/email/providers/imap";
import { startMailProtocolImap } from "./mailProtocolImap";

type Fixture = Awaited<ReturnType<typeof startMailProtocolImap>>;

const fixtures: Fixture[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

async function fixture(options?: Parameters<typeof startMailProtocolImap>[0]) {
  const server = await startMailProtocolImap(options);
  fixtures.push(server);
  return server;
}

async function rawClient(server: Fixture, plaintext = false) {
  const { address, port, tls } = server.endpoint;
  const socket = plaintext
    ? connectTcp({ host: address, port })
    : connectTls({ host: address, port, ...tls });
  socket.setTimeout(10_000, () => socket.destroy(new Error("IMAP fixture response timed out")));
  const lines: string[] = [];
  const waiters: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
  let buffer = "";
  let failure: Error | null = null;
  const fail = (error: Error) => {
    failure = error;
    for (const waiter of waiters.splice(0)) waiter.reject(error);
  };
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    for (;;) {
      const end = buffer.indexOf("\r\n");
      if (end < 0) break;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const waiter = waiters.shift();
      if (waiter === undefined) lines.push(line);
      else waiter.resolve(line);
    }
  });
  socket.on("error", fail);
  socket.on("close", () => fail(new Error("IMAP fixture socket closed")));
  const nextLine = () => {
    const line = lines.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (failure !== null) return Promise.reject(failure);
    return new Promise<string>((resolve, reject) => waiters.push({ resolve, reject }));
  };
  await once(socket, plaintext ? "connect" : "secureConnect");
  expect(await nextLine()).toBe("* OK IMAP fixture");
  return {
    socket,
    readLine: nextLine,
    async command(tag: string, text: string) {
      socket.write(`${tag}${text === "" ? "" : ` ${text}`}\r\n`);
      const response: string[] = [];
      for (;;) {
        const line = await nextLine();
        response.push(line);
        if (line.startsWith(`${tag} `)) return response;
      }
    },
  };
}

function plain(password: string) {
  return Buffer.from(`\0owner@mail.test\0${password}`).toString("base64");
}

describe("IMAP protocol fixture", () => {
  it("rejects malformed and unknown commands, including inherited object names", async () => {
    const server = await fixture();
    const client = await rawClient(server);
    expect(await client.command("A1", "CONSTRUCTOR")).toEqual(["A1 BAD Unsupported CONSTRUCTOR"]);
    expect(await client.command("A2", "TOSTRING")).toEqual(["A2 BAD Unsupported TOSTRING"]);
    expect(await client.command("A3", "__PROTO__")).toEqual(["A3 BAD Unsupported __PROTO__"]);
    expect(await client.command("A4", "")).toEqual(["A4 BAD Malformed command"]);
    expect(server.state.folders.get("Sent")?.messages).toHaveLength(0);
  });

  it("requires successful authentication before mailbox reads and writes", async () => {
    const server = await fixture();
    const client = await rawClient(server);
    for (const [tag, command] of [
      ["A1", 'LIST "" "*"'],
      ["A2", "NAMESPACE"],
      ["A3", 'SELECT "INBOX"'],
      ["A4", "UID SEARCH 1:*"],
      ["A5", 'APPEND "Sent" {3}'],
      ["A6", "CHECK"],
    ] as const) {
      expect(await client.command(tag, command)).toEqual([`${tag} NO Authenticate first`]);
    }
    expect(await client.command("A7", "NOOP")).toEqual(["A7 OK NOOP completed"]);
    expect(await client.command("A8", `AUTHENTICATE PLAIN ${plain("wrong")}`)).toEqual([
      "A8 NO [AUTHENTICATIONFAILED] rejected",
    ]);
    expect(await client.command("A9", 'LIST "" "*"')).toEqual(["A9 NO Authenticate first"]);
    expect(server.state.folders.get("Sent")?.messages).toHaveLength(0);
    expect(await client.command("B1", `AUTHENTICATE PLAIN ${plain("synthetic-password")}`)).toEqual(
      ["B1 OK authenticated"],
    );
    expect((await client.command("B2", 'LIST "" "*"')).at(-1)).toBe("B2 OK LIST completed");
    expect((await client.command("B3", 'SELECT "INBOX"')).at(-1)).toBe(
      "B3 OK [READ-WRITE] selected",
    );
    expect(await client.command("B4", "UID CONSTRUCTOR 1:*")).toEqual([
      "B4 BAD Unsupported UID command",
    ]);
    expect(await client.command("B5", "UID SEARCH 1:*")).toEqual([
      "* SEARCH 1 2 3",
      "B5 OK SEARCH completed",
    ]);
    expect(server.authenticationAttempts()).toBe(2);
  });

  it("denies authentication and mailbox commands before STARTTLS", async () => {
    const server = await fixture({ starttls: true });
    const client = await rawClient(server, true);
    expect((await client.command("A1", "CAPABILITY"))[0]).toContain("STARTTLS");
    expect(await client.command("A2", `AUTHENTICATE PLAIN ${plain("synthetic-password")}`)).toEqual(
      ["A2 NO [PRIVACYREQUIRED] Start TLS first"],
    );
    expect(await client.command("A3", 'LIST "" "*"')).toEqual(["A3 NO Authenticate first"]);
    expect(server.authenticationAttempts()).toBe(0);
    expect(await client.command("A4", "STARTTLS")).toEqual(["A4 OK Begin TLS"]);
    client.socket.destroy();

    const transport = createImapTransport({
      endpoint: server.endpoint,
      username: "owner@mail.test",
      password: "synthetic-password",
    });
    expect(await transport.verify({ signal: new AbortController().signal })).toEqual({
      ok: true,
      value: true,
    });
    expect(server.authenticationAttempts()).toBe(1);
  });

  it("does not treat plaintext commands buffered after STARTTLS as secure", async () => {
    const server = await fixture({ starttls: true });
    const client = await rawClient(server, true);
    client.socket.write(
      `A1 STARTTLS\r\nA2 AUTHENTICATE PLAIN ${plain("synthetic-password")}\r\nA3 APPEND "Sent" {3}\r\nxyz\r\n`,
    );
    expect(await client.readLine()).toBe("A1 OK Begin TLS");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(server.authenticationAttempts()).toBe(0);
    expect(server.state.folders.get("Sent")?.messages).toHaveLength(0);
    client.socket.destroy();
  });

  it("does not process buffered commands after LOGOUT", async () => {
    const server = await fixture();
    const client = await rawClient(server);
    client.socket.write(
      `A1 AUTHENTICATE PLAIN ${plain("synthetic-password")}\r\nA2 LOGOUT\r\nA3 APPEND "Sent" {3}\r\nxyz\r\n`,
    );
    expect(await client.readLine()).toBe("A1 OK authenticated");
    expect(await client.readLine()).toBe("* BYE closing");
    expect(await client.readLine()).toBe("A2 OK logout");
    expect(server.state.folders.get("Sent")?.messages).toHaveLength(0);
  });

  it("keeps the missing STARTTLS test mode unavailable", async () => {
    const server = await fixture({ starttls: true, missingStarttls: true });
    const client = await rawClient(server, true);
    expect((await client.command("A1", "CAPABILITY"))[0]).not.toContain("STARTTLS");
    expect(await client.command("A2", "STARTTLS")).toEqual(["A2 BAD Unsupported STARTTLS"]);
    expect(await client.command("A3", `AUTHENTICATE PLAIN ${plain("synthetic-password")}`)).toEqual(
      ["A3 NO [PRIVACYREQUIRED] Start TLS first"],
    );
    expect(server.authenticationAttempts()).toBe(0);
  });
});
