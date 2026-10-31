import { connect, type Socket } from "node:net";
import { Duplex } from "node:stream";
import { connect as connectTls, TLSSocket } from "node:tls";
import type { ImapTransport } from "imapflow";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import type { ApprovedEndpoint } from "@/features/connections/connectionEndpoint";
import { IMAP_LIMITS } from "./imapTypes";

class SessionResponseBudget {
  private bytes = 0;
  private rows = 0;
  private prefix = "";
  exceeded = false;
  timedOut = false;

  constructor(private readonly discovery: boolean) {}

  private reject(): false {
    this.exceeded = true;
    return false;
  }

  accept(chunk: Buffer): boolean {
    this.bytes += chunk.length;
    const maximum = this.discovery
      ? IMAP_LIMITS.listResponseBytes
      : IMAP_LIMITS.sessionResponseBytes;
    if (this.bytes > maximum) return this.reject();
    if (!this.discovery) return true;
    for (const byte of chunk) {
      if (byte === 10) {
        if (/^\* (?:LIST|LSUB|XLIST) /i.test(this.prefix)) this.rows += 1;
        else if (/^[^*+ ]+ (?:OK|NO|BAD)(?:\s|$)/i.test(this.prefix)) this.rows = 0;
        this.prefix = "";
        if (this.rows > IMAP_LIMITS.folderCount) return this.reject();
      } else if (this.prefix.length < 32) this.prefix += String.fromCharCode(byte);
    }
    return true;
  }
}

// ImapFlow's public transport hook bounds plaintext before its parser sees it.
// A data listener on the SDK socket would still deliver the offending chunk to its parser.
class BudgetSocket extends Duplex {
  constructor(
    private readonly socket: Socket,
    private readonly budget: SessionResponseBudget,
  ) {
    super();
    socket.on("data", this.receive);
    socket.on("error", this.failed);
    socket.on("end", this.ended);
    socket.on("close", this.socketClosed);
    socket.on("timeout", this.timedOut);
  }

  private receive = (chunk: Buffer) => {
    if (!this.budget.accept(chunk)) {
      this.destroy(
        Object.assign(new AppError(ERROR_IDS.MAIL_SYNC_FAILED, "Mailbox response exceeds limits"), {
          code: "ResponseBudgetExceeded",
        }),
      );
    } else if (!this.push(chunk)) this.socket.pause();
  };
  private failed = (error: Error) => this.destroy(error);
  private ended = () => this.push(null);
  private socketClosed = () => this.destroy();
  private timedOut = () => {
    this.budget.timedOut = true;
    this.emit("timeout");
  };

  release(): Socket {
    this.socket.pause();
    this.socket.removeListener("data", this.receive);
    this.socket.removeListener("error", this.failed);
    this.socket.removeListener("end", this.ended);
    this.socket.removeListener("close", this.socketClosed);
    this.socket.removeListener("timeout", this.timedOut);
    return this.socket;
  }

  override _read() {
    this.socket.resume();
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ) {
    this.socket.write(chunk, callback);
  }

  override _final(callback: (error?: Error | null) => void) {
    this.socket.end(callback);
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.socket.destroy();
    callback(error);
  }

  setTimeout(milliseconds: number) {
    this.socket.setTimeout(milliseconds);
  }

  setKeepAlive(enable?: boolean, initialDelay?: number) {
    this.socket.setKeepAlive(enable, initialDelay);
  }

  get authorized() {
    return this.socket instanceof TLSSocket ? this.socket.authorized : undefined;
  }

  getCipher() {
    return this.socket instanceof TLSSocket ? this.socket.getCipher() : null;
  }
}

export function imapBoundedTransport(endpoint: ApprovedEndpoint, discovery: boolean) {
  const budget = new SessionResponseBudget(discovery);
  const transport: ImapTransport = {
    connect(options, onConnect) {
      const destination = { host: endpoint.address, port: endpoint.port };
      const socket = options.secure
        ? connectTls({ ...destination, ...endpoint.tls }, onConnect)
        : connect(destination, onConnect);
      return new BudgetSocket(socket, budget);
    },
    upgrade(socket, _options, onSecure) {
      if (!(socket instanceof BudgetSocket))
        throw new AppError(ERROR_IDS.MAIL_SYNC_FAILED, "Invalid mailbox discovery transport");
      // Detach the plaintext wrapper before TLS owns the pinned socket. Ciphertext must
      // never be scanned as IMAP; the replacement wrapper counts decrypted bytes only.
      const plain = socket.release();
      const secure = connectTls(
        { socket: plain, host: endpoint.address, port: endpoint.port, ...endpoint.tls },
        onSecure,
      );
      return new BudgetSocket(secure, budget);
    },
  };
  return { transport, exceeded: () => budget.exceeded, timedOut: () => budget.timedOut };
}
