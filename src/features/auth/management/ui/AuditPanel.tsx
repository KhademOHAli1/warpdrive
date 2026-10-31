"use client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { ManagementQuery, ManagementSnapshot } from "../contracts";
import type { ManagementMessages } from "../messages";
import { ManagementStatus } from "./ManagementStatus";
import { useManagementFormat } from "./useManagementFormat";

function eventLabel(action: string, L: ManagementMessages): string {
  const labels: [string[], string][] = [
    [["invitation"], L.eventInvitation],
    [["session", "revoke"], L.eventSession],
    [["sign", "login"], L.eventLogin],
    [["recovery"], L.eventRecovery],
    [["policy"], L.eventPolicy],
    [["user", "permission", "visibility"], L.eventUser],
    [["factor", "passkey"], L.eventFactor],
    [["mail"], L.eventMail],
    [["account"], L.eventAccount],
  ];
  return (
    labels.find(([matches]) => matches.some((match) => action.includes(match)))?.[1] ?? L.eventOther
  );
}
export function AuditPanel({
  L,
  snapshot,
  query,
  setQuery,
}: {
  L: ManagementMessages;
  snapshot: ManagementSnapshot;
  query: ManagementQuery;
  setQuery: (query: ManagementQuery) => void;
}) {
  const format = useManagementFormat();
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold">{L.auditTitle}</h2>
      <div className="flex flex-wrap gap-3">
        <Input
          aria-label={L.auditSearch}
          placeholder={L.auditSearch}
          value={query.auditQ ?? ""}
          onChange={(event) => setQuery({ ...query, auditQ: event.target.value, auditPage: 1 })}
          className="sm:max-w-80"
        />
        <div className="w-full sm:w-48">
          <Select
            ariaLabel={L.auditOutcome}
            value={query.auditOutcome ?? "all"}
            onChange={(value) =>
              setQuery({
                ...query,
                auditOutcome: value as ManagementQuery["auditOutcome"],
                auditPage: 1,
              })
            }
            options={[
              { value: "all", label: L.all },
              { value: "success", label: L.success },
              { value: "denied", label: L.denied },
              { value: "failure", label: L.failure },
            ]}
          />
        </div>
      </div>
      {snapshot.audit.length === 0 ? (
        <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
          {L.noEvents}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[620px] text-start text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr>
                {[L.event, L.actor, L.target, L.outcome, L.when].map((label) => (
                  <th key={label} className="px-4 py-3 text-start font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshot.audit.map((event) => (
                <tr key={event.id} className="border-t">
                  <td className="px-4 py-3.5 font-medium">{eventLabel(event.action, L)}</td>
                  <td className="px-4 py-3.5">{event.actorName ?? L.system}</td>
                  <td className="px-4 py-3.5">{event.targetName ?? L.notAvailable}</td>
                  <td className="px-4 py-3.5">
                    <ManagementStatus state={event.outcome} L={L} />
                  </td>
                  <td className="px-4 py-3.5 text-xs text-muted-foreground">
                    {format.date(event.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 text-sm">
        <Button
          variant="outline"
          size="sm"
          disabled={snapshot.auditPage <= 1}
          onClick={() => setQuery({ ...query, auditPage: snapshot.auditPage - 1 })}
        >
          {L.previous}
        </Button>
        <span>
          {L.page} {format.number(snapshot.auditPage)} {L.of}{" "}
          {format.number(snapshot.auditPageCount)}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={snapshot.auditPage >= snapshot.auditPageCount}
          onClick={() => setQuery({ ...query, auditPage: snapshot.auditPage + 1 })}
        >
          {L.next}
        </Button>
      </div>
    </section>
  );
}
