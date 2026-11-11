import type { SmtpRelayLimits } from "./contracts";
import type { adminMessages } from "./messages";

export function RelayLimits({
  relay,
  index,
  L,
}: {
  relay: SmtpRelayLimits;
  index: number;
  L: ReturnType<typeof adminMessages>;
}) {
  const data = [
    [L.relayTls, relay.tls],
    [L.connections, relay.maxConnections],
    [L.retries, relay.retries],
    [L.idle, relay.idleTimeout],
    [L.wait, relay.waitTimeout],
    [L.retryDelay, relay.retryDelay],
    [L.senderRestrictions, relay.senderRestrictions],
  ] as const;
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="mb-2 flex justify-between gap-2 text-sm font-medium">
        <span>{relay.name ?? `${L.relay} ${index + 1}`}</span>
        <span className="text-muted-foreground">{relay.enabled ? L.on : L.off}</span>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {data.map(([label, value]) => (
          <div key={label} className="text-xs">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium" dir="auto">
              {value ?? L.unknown}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
