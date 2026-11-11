"use client";

// One socket and one abortable ticket request per tab. Mounted channels recover with bounded
// backoff; a server subscription ACK is the barrier for refetching events missed while offline.
export interface WsFrame {
  kind: string;
  channel?: string;
  event?: { seq: number; type: string; data: unknown };
  users?: unknown;
}

export type ChannelHandler = (frame: WsFrame) => void;
export type TicketMinter = (signal: AbortSignal) => Promise<string>;
export type SocketFactory = (url: string) => WebSocket;

// Only the HTTP ticket adapter creates this marker for a confirmed authorization refusal.
// A socket 4401 can instead mean its single-use ticket expired, so it gets a fresh attempt.
export class TicketAuthorizationDenied extends Error {}

type State = "idle" | "connecting" | "authed" | "blocked";
type Stage = "ticket" | "connect" | "auth";
type Timer = ReturnType<typeof setTimeout>;
const ATTEMPT_DEADLINE_MS = 10_000;
const STABLE_CONNECTION_MS = 30_000;

export class WsMultiplexer {
  private socket: WebSocket | null = null;
  private closingSocket: WebSocket | null = null;
  private state: State = "idle";
  private stage: Stage | null = null;
  private stageExpiresAt = 0;
  private connectionGeneration = 0;
  private ticketRequest: AbortController | null = null;
  private retryTimer: Timer | null = null;
  private stageTimer: Timer | null = null;
  private ackTimer: Timer | null = null;
  private stageToken = 0;
  private ackToken = 0;
  private failures = 0;
  private outageNotified = false;
  private stableSince: number | null = null;
  private readonly handlers = new Map<string, Set<ChannelHandler>>();
  private readonly subscribedOnSocket = new Set<string>();
  private readonly acknowledged = new Set<string>();
  private readonly denied = new Set<string>();
  private readonly pendingAcks = new Map<string, number>();
  private readonly retiring = new Map<string, "subscribe" | "unsubscribe">();

  constructor(
    private readonly url: string,
    private readonly mintTicket: TicketMinter,
    private readonly makeSocket: SocketFactory = (u) => new WebSocket(u),
  ) {}

  subscribe(channel: string, handler: ChannelHandler): () => void {
    let set = this.handlers.get(channel);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(channel, set);
    }
    set.add(handler);
    this.ensureConnected();
    if (this.state === "authed") this.sendSubscribe(channel);
    return () => this.removeHandler(channel, handler);
  }

  private removeHandler(channel: string, handler: ChannelHandler): void {
    const set = this.handlers.get(channel);
    if (set === undefined) return;
    set.delete(handler);
    if (set.size > 0) return;
    this.handlers.delete(channel);
    if (this.handlers.size === 0) {
      this.resetConnection();
      this.state = "idle";
      this.failures = 0;
      this.outageNotified = false;
      return;
    }
    const wasSubscribed = this.subscribedOnSocket.delete(channel);
    const awaitingSubscribe = this.pendingAcks.has(channel);
    const wasDenied = this.denied.has(channel);
    this.acknowledged.delete(channel);
    this.denied.delete(channel);
    if (wasSubscribed && !wasDenied) {
      // Server dispatch is concurrent. First wait for an in-flight subscribe to finish; otherwise
      // unsubscribe can arrive before it exists. Re-additions wait for its actual unsubscribe ACK.
      this.retiring.set(channel, awaitingSubscribe ? "subscribe" : "unsubscribe");
      if (!awaitingSubscribe) this.pendingAcks.set(channel, Date.now() + ATTEMPT_DEADLINE_MS);
    }
    this.armAckDeadline();
    if (wasSubscribed && !wasDenied && !awaitingSubscribe && this.socket !== null) {
      this.send(this.socket, { kind: "unsubscribe", channel });
    }
  }

  private ensureConnected(): void {
    if (this.url === "" || this.handlers.size === 0 || this.state !== "idle") return;
    if (this.retryTimer !== null || this.ticketRequest !== null || this.closingSocket !== null)
      return;
    this.state = "connecting";
    const generation = ++this.connectionGeneration;
    const request = new AbortController();
    this.ticketRequest = request;
    this.armStageDeadline("ticket", generation);
    void this.connect(generation, request);
  }

  private async connect(generation: number, request: AbortController): Promise<void> {
    let ticket: string;
    try {
      ticket = await this.mintTicket(request.signal);
    } catch (error) {
      if (generation === this.connectionGeneration) {
        this.fail(generation, error instanceof TicketAuthorizationDenied);
      }
      return;
    } finally {
      if (this.ticketRequest === request) this.ticketRequest = null;
      // An abort-ignoring request retains the sole mint slot until it actually settles. A remount
      // can then mint a fresh ticket; its abandoned predecessor's result is never reused.
      if (generation !== this.connectionGeneration) this.ensureConnected();
    }
    if (generation !== this.connectionGeneration) return;
    // Background tabs can defer timer callbacks. A late completion cannot extend its deadline.
    if (Date.now() >= this.stageExpiresAt) {
      this.fail(generation);
      return;
    }
    if (typeof ticket !== "string" || ticket.trim() === "") {
      this.fail(generation);
      return;
    }
    this.openSocket(ticket, generation);
  }

  private openSocket(ticket: string, generation: number): void {
    let ws: WebSocket;
    try {
      ws = this.makeSocket(this.url);
    } catch {
      this.fail(generation);
      return;
    }
    this.socket = ws;
    this.armStageDeadline("connect", generation);
    ws.onopen = () => {
      if (!this.isCurrent(ws, generation) || this.stage !== "connect") return;
      if (Date.now() >= this.stageExpiresAt) {
        this.fail(generation);
        return;
      }
      this.armStageDeadline("auth", generation);
      this.send(ws, { kind: "auth", ticket });
    };
    ws.onmessage = (evt: MessageEvent<string>) => {
      if (this.isCurrent(ws, generation)) this.onMessage(ws, evt.data);
    };
    ws.onerror = ws.onclose = () => {
      if (this.isCurrent(ws, generation, false)) this.fail(generation);
    };
  }

  private isCurrent(ws: WebSocket, generation: number, requireOpen = true): boolean {
    return (
      generation === this.connectionGeneration &&
      this.socket === ws &&
      (!requireOpen || ws.readyState === WebSocket.OPEN)
    );
  }

  private onMessage(ws: WebSocket, data: string): void {
    if (this.stage !== null && Date.now() >= this.stageExpiresAt) {
      this.fail(this.connectionGeneration);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== "object" || !("kind" in parsed)) return;
    if (typeof parsed.kind !== "string") return;
    const frame = parsed as WsFrame;
    if (frame.kind === "auth_ok") {
      if (this.stage !== "auth") return;
      this.clearStageDeadline();
      this.state = "authed";
      for (const channel of this.handlers.keys()) this.sendSubscribe(channel);
      return;
    }
    if (this.state !== "authed") return;
    if (typeof frame.channel === "string") {
      this.onChannelFrame(frame, frame.channel);
      return;
    }
    // Server-wide resync frames retain their existing meaning.
    if (this.socket === ws) this.notifyAll(frame);
  }

  private onChannelFrame(frame: WsFrame, channel: string): void {
    if (this.rejectExpiredAck(frame, channel)) return;
    if (this.retiring.has(channel)) {
      this.onRetiringFrame(frame, channel);
      return;
    }
    const set = this.handlers.get(channel);
    if (set === undefined || !this.subscribedOnSocket.has(channel) || this.denied.has(channel))
      return;
    if (frame.kind === "subscribed") {
      if (!this.pendingAcks.delete(channel)) return;
      this.acknowledged.add(channel);
      this.armAckDeadline();
      this.outageNotified = false;
      for (const handler of set) handler({ kind: "resync", channel });
    } else if (frame.kind === "error") {
      this.pendingAcks.delete(channel);
      this.denied.add(channel);
      this.armAckDeadline();
    }
    for (const handler of set) handler(frame);
  }

  private rejectExpiredAck(frame: WsFrame, channel: string): boolean {
    if (frame.kind !== "subscribed" && frame.kind !== "unsubscribed") return false;
    const deadline = this.pendingAcks.get(channel);
    if (deadline === undefined || Date.now() < deadline) return false;
    this.fail(this.connectionGeneration);
    return true;
  }

  private onRetiringFrame(frame: WsFrame, channel: string): void {
    const phase = this.retiring.get(channel);
    if (phase === "subscribe" && frame.kind === "subscribed" && this.socket !== null) {
      this.retiring.set(channel, "unsubscribe");
      this.pendingAcks.set(channel, Date.now() + ATTEMPT_DEADLINE_MS);
      this.armAckDeadline();
      this.send(this.socket, { kind: "unsubscribe", channel });
      return;
    }
    const denied = phase === "subscribe" && frame.kind === "error";
    const removed = phase === "unsubscribe" && frame.kind === "unsubscribed";
    if (!denied && !removed) return;
    this.retiring.delete(channel);
    this.pendingAcks.delete(channel);
    this.armAckDeadline();
    if (this.handlers.has(channel)) this.sendSubscribe(channel);
  }

  private sendSubscribe(channel: string): void {
    const ws = this.socket;
    if (ws === null || this.state !== "authed" || this.subscribedOnSocket.has(channel)) return;
    if (this.retiring.has(channel)) return;
    this.subscribedOnSocket.add(channel);
    this.pendingAcks.set(channel, Date.now() + ATTEMPT_DEADLINE_MS);
    this.stableSince = null;
    this.armAckDeadline();
    this.send(ws, { kind: "subscribe", channel });
  }

  private send(ws: WebSocket, frame: object): void {
    if (this.socket !== ws) return;
    const generation = this.connectionGeneration;
    try {
      if (ws.readyState !== WebSocket.OPEN) {
        this.fail(generation);
        return;
      }
      ws.send(JSON.stringify(frame));
    } catch {
      this.fail(generation);
    }
  }

  private armStageDeadline(stage: Stage, generation: number): void {
    this.clearStageDeadline();
    this.stage = stage;
    this.stageExpiresAt = Date.now() + ATTEMPT_DEADLINE_MS;
    const token = this.stageToken;
    this.stageTimer = setTimeout(() => {
      if (token === this.stageToken && generation === this.connectionGeneration) {
        this.fail(generation);
      }
    }, ATTEMPT_DEADLINE_MS);
  }

  private clearStageDeadline(): void {
    this.stageToken++;
    if (this.stageTimer !== null) clearTimeout(this.stageTimer);
    this.stageTimer = null;
    this.stage = null;
  }

  private armAckDeadline(): void {
    this.ackToken++;
    if (this.ackTimer !== null) clearTimeout(this.ackTimer);
    this.ackTimer = null;
    if (this.pendingAcks.size === 0) {
      if (this.acknowledged.size > 0 && this.stableSince === null) this.stableSince = Date.now();
      return;
    }
    const deadline = Math.min(...this.pendingAcks.values());
    const token = this.ackToken;
    const generation = this.connectionGeneration;
    this.ackTimer = setTimeout(
      () => {
        if (token === this.ackToken && generation === this.connectionGeneration)
          this.fail(generation);
      },
      Math.max(0, deadline - Date.now()),
    );
  }

  private fail(generation: number, authorizationDenied = false): void {
    if (generation !== this.connectionGeneration) return;
    if (this.stableSince !== null && Date.now() - this.stableSince >= STABLE_CONNECTION_MS) {
      this.failures = 0;
    }
    this.resetConnection();
    this.state = authorizationDenied ? "blocked" : "idle";
    if (this.handlers.size === 0) return;
    if (!authorizationDenied) this.scheduleRetry();
    if (this.outageNotified) return;
    this.outageNotified = true;
    // Establish backoff before callbacks: a callback can synchronously mount or remove channels.
    this.notifyAll({ kind: "reconnect" });
  }

  private scheduleRetry(): void {
    const ceiling = Math.min(30_000, 1_000 * 2 ** this.failures);
    this.failures = Math.min(this.failures + 1, 6);
    const delay = ceiling * (0.5 + Math.random() * 0.5);
    const generation = this.connectionGeneration;
    this.retryTimer = setTimeout(() => {
      if (generation !== this.connectionGeneration) return;
      this.retryTimer = null;
      this.ensureConnected();
    }, delay);
  }

  private resetConnection(): void {
    this.connectionGeneration++;
    this.clearStageDeadline();
    this.ackToken++;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    if (this.ackTimer !== null) clearTimeout(this.ackTimer);
    this.retryTimer = this.ackTimer = null;
    this.pendingAcks.clear();
    this.retiring.clear();
    this.subscribedOnSocket.clear();
    this.acknowledged.clear();
    this.denied.clear();
    this.stableSince = null;
    this.ticketRequest?.abort();
    const ws = this.socket;
    this.socket = null;
    if (ws === null) return;
    ws.onopen = ws.onmessage = ws.onerror = null;
    if (ws.readyState === WebSocket.CLOSED) {
      ws.onclose = null;
      return;
    }
    // Browsers have no terminate(). Keep one closing slot until actual closure so an unresponsive
    // peer cannot accumulate CLOSING sockets through deadline-driven replacement attempts.
    this.closingSocket = ws;
    ws.onclose = () => {
      if (this.closingSocket !== ws) return;
      this.closingSocket = null;
      ws.onclose = null;
      this.ensureConnected();
    };
    try {
      ws.close();
    } catch {
      // Keep the bounded closing slot until closure can actually be observed.
    }
  }

  private notifyAll(frame: WsFrame): void {
    for (const set of this.handlers.values()) for (const handler of set) handler(frame);
  }
}
