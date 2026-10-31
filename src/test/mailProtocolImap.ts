import { createServer, type Socket } from "node:net";
import { createSecureContext, createServer as createTlsServer, TLSSocket } from "node:tls";
import { resolveConnectionEndpoint } from "@/features/connections/endpointPolicy";
import { buildMime } from "@/features/email/mime";
import {
  completeImapAppend,
  imapFixtureCommand,
  type MailProtocolImapState,
} from "./mailProtocolImapCommands";
import { MAIL_PROTOCOL_TEST_CERT, MAIL_PROTOCOL_TEST_KEY } from "./mailProtocolTls";

export async function startMailProtocolImap(
  options: {
    starttls?: boolean;
    missingStarttls?: boolean;
    move?: boolean;
    readOnly?: boolean;
    stallSelect?: boolean;
  } = {},
) {
  const state: MailProtocolImapState = {
    folders: new Map([
      [
        "INBOX",
        {
          validity: "123",
          readOnly: options.readOnly === true,
          messages: [1, 2, 3].map((uid) => ({
            uid,
            flags: uid === 2 ? ["\\Seen"] : [],
            date: new Date(uid === 1 ? "2026-09-01T12:00Z" : "2026-10-31T12:00Z"),
            source: Buffer.from(
              buildMime({
                from: "sender@mail.test",
                to: ["owner@mail.test"],
                subject: uid === 1 ? "سلام" : "Grüße",
                html: "<p>body</p>",
                messageId: `<message-${uid}@mail.test>`,
              }),
            ),
          })),
        },
      ],
      ["Sent", { validity: "456", readOnly: false, messages: [], specialUse: "\\Sent" }],
    ]),
    sourceFetches: 0,
    commands: [],
    move: options.move !== false,
    stallSelect: options.stallSelect === true,
  };
  let authenticationAttempts = 0;
  const sockets = new Set<Socket>();
  const secureContext = createSecureContext({
    key: MAIL_PROTOCOL_TEST_KEY,
    cert: MAIL_PROTOCOL_TEST_CERT,
  });
  function accepted(initial: Socket) {
    let socket = initial;
    let input = Buffer.alloc(0);
    let secured = options.starttls !== true;
    let authTag: string | null = null;
    let append: { length: number; tag: string; path: string } | null = null;
    const session = { selected: "" };
    sockets.add(socket);
    socket.on("close", () => sockets.delete(initial));
    socket.on("error", () => {});
    const write = (data: Buffer | string) => {
      if (
        typeof data === "string" &&
        ((state.dropMutationResponse === "STORE" && / OK STORE completed\r\n$/.test(data)) ||
          (state.dropMutationResponse === "MOVE" &&
            / OK (?:\[COPYUID [^\]]+\] )?moved\r\n$/.test(data)) ||
          (state.dropMutationResponse === "APPEND" &&
            / OK \[APPENDUID [^\]]+\] appended\r\n$/.test(data)))
      ) {
        socket.destroy();
        return;
      }
      socket.write(data);
    };
    function authentication(tag: string, encoded: string) {
      authenticationAttempts += 1;
      const pieces = Buffer.from(encoded, "base64").toString().split("\0");
      write(
        pieces.at(-2) === "owner@mail.test" && pieces.at(-1) === "synthetic-password"
          ? `${tag} OK authenticated\r\n`
          : `${tag} NO [AUTHENTICATIONFAILED] rejected\r\n`,
      );
    }
    function consumeAppend(): boolean {
      const pending = append;
      if (pending === null) return true;
      if (input.length < pending.length + 2) return false;
      const result = completeImapAppend(state, pending.path, input.subarray(0, pending.length));
      input = input.subarray(pending.length + 2);
      write(
        result === null
          ? `${pending.tag} NO Cannot append\r\n`
          : `${pending.tag} OK [APPENDUID ${result.validity} ${result.uid}] appended\r\n`,
      );
      append = null;
      return true;
    }
    function capability(tag: string) {
      write(
        `* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR NAMESPACE UIDPLUS ${state.move ? "MOVE" : ""} ${!secured && options.missingStarttls !== true ? "STARTTLS" : ""}\r\n${tag} OK capabilities\r\n`,
      );
    }
    function upgrade(tag: string) {
      if (options.missingStarttls === true) {
        write(`${tag} NO unsupported\r\n`);
        return;
      }
      socket.removeListener("data", data);
      write(`${tag} OK Begin TLS\r\n`);
      socket = new TLSSocket(socket, { isServer: true, secureContext });
      secured = true;
      socket.on("data", data);
      socket.on("error", () => {});
    }
    function authenticate(tag: string, rest: string) {
      const encoded = rest.split(" ")[1];
      if (encoded === undefined) {
        authTag = tag;
        write("+ \r\n");
      } else authentication(tag, encoded);
    }
    function beginAppend(tag: string, rest: string) {
      const literal = /\{(\d+)\}$/.exec(rest);
      const path = /^"([^"]+)"/.exec(rest)?.[1] ?? rest.split(" ")[0] ?? "";
      if (literal === null) {
        write(`${tag} BAD No literal\r\n`);
        return;
      }
      append = { length: Number(literal[1]), tag, path };
      write("+ Ready for literal\r\n");
    }
    const commands: Record<string, (tag: string, rest: string) => void> = {
      CAPABILITY: capability,
      STARTTLS: upgrade,
      AUTHENTICATE: authenticate,
      APPEND: beginAppend,
      LOGOUT(tag) {
        write(`* BYE closing\r\n${tag} OK logout\r\n`);
        socket.end();
      },
    };
    function commandLine(line: string) {
      if (authTag !== null) {
        authentication(authTag, line);
        authTag = null;
        return;
      }
      const match = /^(\S+) (\S+)(?: (.*))?$/.exec(line);
      if (match === null) return;
      const [, tag = "", verb = "", rest = ""] = match;
      const command = verb.toUpperCase();
      const handler = commands[command];
      if (handler !== undefined) handler(tag, rest);
      else imapFixtureCommand(state, session, tag, command, rest, write);
    }
    function data(chunk: Buffer) {
      input = Buffer.concat([input, chunk]);
      for (;;) {
        if (append !== null) {
          if (!consumeAppend()) return;
          continue;
        }
        const end = input.indexOf("\r\n");
        if (end < 0) return;
        const line = input.subarray(0, end).toString();
        input = input.subarray(end + 2);
        commandLine(line);
      }
    }
    socket.on("data", data);
    write("* OK IMAP fixture\r\n");
  }
  const server =
    options.starttls === true
      ? createServer(accepted)
      : createTlsServer({ key: MAIL_PROTOCOL_TEST_KEY, cert: MAIL_PROTOCOL_TEST_CERT }, accepted);
  server.on("error", () => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("IMAP fixture has no port");
  const protocol = options.starttls === true ? "imap+starttls" : "imaps";
  const endpoint = await resolveConnectionEndpoint(
    { protocol, host: "mail.test", port: address.port },
    {
      internalEndpoints: [
        {
          protocol,
          host: "mail.test",
          port: address.port,
          allowedAddresses: ["127.0.0.1"],
          allowLoopback: true,
          ca: MAIL_PROTOCOL_TEST_CERT,
        },
      ],
    },
    new AbortController().signal,
    () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
  );
  if (!endpoint.ok) throw new Error("IMAP fixture endpoint rejected");
  return {
    endpoint: endpoint.value,
    state,
    authenticationAttempts: () => authenticationAttempts,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
