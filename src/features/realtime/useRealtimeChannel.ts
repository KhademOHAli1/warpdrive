"use client";
import { TRPCClientError } from "@trpc/client";
import { useEffect } from "react";
import { clientEnv } from "@/config/clientEnv";
import { trpc } from "@/lib/trpc-client";
import { resolveRealtimeUrl } from "./realtimeUrl";
import {
  type ChannelHandler,
  TicketAuthorizationDenied,
  type TicketMinter,
  WsMultiplexer,
} from "./wsMultiplexer";

// One multiplexer per tab. The ticket minter is a mutable reference kept fresh by every mounted
// subscriber's effect, so the multiplexer always mints through a live raw tRPC client even after the
// component that first created it unmounts. Client module state is per-tab, so this singleton is
// safe (unlike server module singletons, which can duplicate across bundle layers).
let multiplexer: WsMultiplexer | null = null;
let ticketMinter: TicketMinter | null = null;

function getMultiplexer(): WsMultiplexer {
  if (multiplexer === null) {
    // Called from the subscription effect, never during SSR or module initialization.
    const url = resolveRealtimeUrl(clientEnv.WS_PUBLIC_URL, window.location);
    multiplexer = new WsMultiplexer(url, (signal) =>
      ticketMinter !== null
        ? ticketMinter(signal)
        : Promise.reject(new Error("no realtime ticket minter")),
    );
  }
  return multiplexer;
}

// Subscribe a component to a realtime channel over the shared tab socket, replacing the old
// one-socket-per-hook wiring. onFrame receives the channel's event/presence frames and a synthetic
// { kind: "reconnect" } on an outage and channel resync after the subscription ACK. Pass
// channel=null to opt out (e.g. before an id is known). onFrame must be stable across renders (wrap
// in useCallback) or the subscription re-registers each render.
export function useRealtimeChannel(channel: string | null, onFrame: ChannelHandler): void {
  const client = trpc.useUtils().client;
  useEffect(() => {
    // Use the raw client: retries are abortable and do not trigger mutation-cache error toasts.
    ticketMinter = async (signal) => {
      try {
        const result = await client.realtime.ticket.mutate(undefined, { signal });
        return result.ticket;
      } catch (error) {
        if (error instanceof TRPCClientError) {
          const data: unknown = error.data;
          if (data !== null && typeof data === "object" && "code" in data) {
            if (data.code === "UNAUTHORIZED" || data.code === "FORBIDDEN") {
              throw new TicketAuthorizationDenied();
            }
          }
        }
        throw error;
      }
    };
    if (channel === null) return;
    return getMultiplexer().subscribe(channel, onFrame);
  }, [channel, onFrame, client]);
}
