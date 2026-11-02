import { SMTPServer } from "smtp-server";
import { resolveConnectionEndpoint } from "@/features/connections/endpointPolicy";
import { MAIL_PROTOCOL_TEST_CERT, MAIL_PROTOCOL_TEST_KEY } from "./mailProtocolTls";

export async function startMailProtocolSmtp(
  options: {
    starttls?: boolean;
    missingStarttls?: boolean;
    dropAfterData?: boolean;
    stallAfterData?: boolean;
    hideSmtpUtf8?: boolean;
    rejectAfterDataCode?: 450 | 550;
  } = {},
) {
  const received: Buffer[] = [];
  let authenticationAttempts = 0;
  const server = new SMTPServer({
    logger: false,
    secure: options.starttls !== true,
    key: MAIL_PROTOCOL_TEST_KEY,
    cert: MAIL_PROTOCOL_TEST_CERT,
    hideSMTPUTF8: options.hideSmtpUtf8 === true,
    disabledCommands: options.missingStarttls === true ? ["STARTTLS"] : [],
    onAuth(auth, _session, callback) {
      authenticationAttempts += 1;
      if (auth.username === "owner@mail.test" && auth.password === "synthetic-password")
        callback(null, { user: "owner" });
      else
        callback(
          Object.assign(new Error("synthetic authentication rejected"), { responseCode: 535 }),
        );
    },
    onRcptTo(address, _session, callback) {
      callback(
        address.address === "reject@mail.test"
          ? Object.assign(new Error("synthetic recipient rejected"), { responseCode: 550 })
          : null,
      );
    },
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        received.push(Buffer.concat(chunks));
        if (options.rejectAfterDataCode !== undefined)
          callback(
            Object.assign(new Error("synthetic DATA rejected"), {
              responseCode: options.rejectAfterDataCode,
            }),
          );
        else if (options.dropAfterData === true)
          for (const connection of server.connections) connection.close();
        else if (options.stallAfterData !== true) callback(null, "accepted fixture");
      });
    },
  });
  server.on("error", () => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.server.address();
  if (address === null || typeof address === "string") throw new Error("SMTP fixture has no port");
  const endpoint = await resolveConnectionEndpoint(
    {
      protocol: options.starttls === true ? "smtp+starttls" : "smtps",
      host: "mail.test",
      port: address.port,
    },
    {
      internalEndpoints: [
        {
          protocol: options.starttls === true ? "smtp+starttls" : "smtps",
          host: "mail.test",
          port: address.port,
          allowLoopback: true,
          allowedAddresses: ["127.0.0.1"],
          ca: MAIL_PROTOCOL_TEST_CERT,
        },
      ],
    },
    new AbortController().signal,
    () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]),
  );
  if (!endpoint.ok) throw new Error("SMTP fixture endpoint rejected");
  return {
    endpoint: endpoint.value,
    received,
    authenticationAttempts: () => authenticationAttempts,
    disconnect() {
      for (const connection of server.connections) connection.close();
    },
    async close() {
      for (const connection of server.connections) connection.close();
      await new Promise<void>((resolve) => server.close(resolve));
    },
  };
}
