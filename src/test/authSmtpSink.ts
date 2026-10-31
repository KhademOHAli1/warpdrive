import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";

export interface CapturedAuthMail {
  recipient: string;
  raw: string;
}

interface SmtpEnvelope {
  recipient: string;
  collecting: boolean;
}

function respondToCommand(socket: Socket, line: string, envelope: SmtpEnvelope) {
  const command = line.toUpperCase();
  if (command.startsWith("EHLO ") || command.startsWith("HELO "))
    socket.write("250-local-auth.test\r\n250 SIZE 1048576\r\n");
  else if (command.startsWith("MAIL FROM:")) socket.write("250 Sender accepted\r\n");
  else if (command.startsWith("RCPT TO:")) {
    envelope.recipient = /<([^>]+)>/.exec(line)?.[1] ?? "";
    socket.write("250 Recipient accepted\r\n");
  } else if (command === "DATA") {
    envelope.collecting = true;
    socket.write("354 End with a dot\r\n");
  } else if (command === "QUIT") socket.end("221 Closing connection\r\n");
  else if (command === "RSET" || command === "NOOP") socket.write("250 OK\r\n");
  else socket.write("502 Command not supported\r\n");
}

// A loopback SMTP receiver exercises Nodemailer's real wire transport without sending mail
// outside the test process. It deliberately offers no authentication or TLS capability.
export async function startAuthSmtpSink() {
  const messages: CapturedAuthMail[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    socket.setTimeout(10_000, () => socket.destroy());
    let buffered = "";
    const envelope: SmtpEnvelope = { recipient: "", collecting: false };
    let content = "";
    socket.write("220 local-auth.test ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffered += chunk.toString("latin1");
      if (buffered.length + content.length > 1_048_576) {
        socket.destroy();
        return;
      }
      while (buffered.includes("\r\n")) {
        const newline = buffered.indexOf("\r\n");
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 2);
        if (envelope.collecting) {
          if (line === ".") {
            messages.push({ recipient: envelope.recipient, raw: content });
            envelope.collecting = false;
            content = "";
            socket.write("250 Message accepted\r\n");
          } else content += `${line.startsWith("..") ? line.slice(1) : line}\r\n`;
          continue;
        }
        respondToCommand(socket, line, envelope);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert(address !== null && typeof address !== "string");
  return {
    port: address.port,
    messages,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

export function decodedSmtpBody(raw: string): string {
  return raw
    .split(/\r\n--[^\r\n]+\r\n/)
    .map((part) => {
      const separator = part.indexOf("\r\n\r\n");
      if (separator === -1) return "";
      const headers = part.slice(0, separator);
      const body = part.slice(separator + 4);
      if (/Content-Transfer-Encoding:\s*base64/i.test(headers))
        return Buffer.from(body, "base64").toString("utf8");
      const unwrapped = body
        .replace(/=\r\n/g, "")
        .replace(/=([a-fA-F0-9]{2})/g, (_, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        );
      return Buffer.from(unwrapped, "latin1").toString("utf8");
    })
    .join("\n");
}
