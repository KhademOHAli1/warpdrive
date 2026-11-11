"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { personNewsletterMessages } from "@/features/contacts/personNewsletterMessages";
import { useLocale } from "@/features/i18n/LocaleProvider";
import type { PersonNewsletterSummary } from "@/features/newsletter/identity/contracts";
import { MASK_CLASS } from "@/features/observability/replayMasking";
import { trpc } from "@/lib/trpc-client";
import { useFormatters } from "@/lib/useFormatters";
import { type PersonNewsletterAction, PersonNewsletterActions } from "./PersonNewsletterActions";
import { PersonNewsletterAttribution } from "./PersonNewsletterAttribution";

type Address = PersonNewsletterSummary["addresses"][number];

function PersonNewsletterLinkControls({
  link,
  address,
  summary,
  onAction,
}: {
  link: Address["links"][number];
  address: string;
  summary: PersonNewsletterSummary;
  onAction: (action: PersonNewsletterAction) => void;
}) {
  const L = personNewsletterMessages[useLocale()];
  const choices = summary.eligibleLists.filter((list) => {
    const membership = link.consent?.lists.find(({ id }) => id === list.id);
    return membership === undefined || membership.subscriptionStatus === "unconfirmed";
  });
  return (
    <div className="flex flex-wrap gap-2">
      {(link.state === "pending" || link.state === "expired") && summary.engineAvailable && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onAction({ kind: "reconcile", linkId: link.id, address })}
        >
          {L.actions.reconcile}
        </Button>
      )}
      {link.state === "verified" &&
        !link.shared &&
        link.consent?.status === "enabled" &&
        summary.deliveryAvailable &&
        choices.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onAction({ kind: "invite", linkId: link.id, address, lists: choices })}
          >
            {L.actions.invite}
          </Button>
        )}
      {link.state === "verified" && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onAction({ kind: "detach", linkId: link.id, address })}
        >
          {L.actions.detach}
        </Button>
      )}
    </div>
  );
}

function PersonNewsletterAddress({
  row,
  summary,
  onAction,
}: {
  row: Address;
  summary: PersonNewsletterSummary;
  onAction?: (action: PersonNewsletterAction) => void;
}) {
  const L = personNewsletterMessages[useLocale()];
  const format = useFormatters();
  const canVerify =
    onAction !== undefined &&
    summary.deliveryAvailable &&
    row.links.every(({ state }) => state === "detached");
  return (
    <section className="rounded-md border p-4">
      <h3 className="font-medium">
        <bdi className={MASK_CLASS}>{row.address}</bdi>
      </h3>
      {row.links.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{L.noLink}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {row.links.map((link) => (
            <li key={link.id} className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{L.link[link.state]}</Badge>
                {link.shared && <Badge variant="outline">{L.shared}</Badge>}
                {link.consent && <Badge variant="outline">{L.status[link.consent.status]}</Badge>}
                {link.verifiedAt !== null && (
                  <time dateTime={new Date(link.verifiedAt).toISOString()}>
                    {format.dateTime(link.verifiedAt)}
                  </time>
                )}
              </div>
              {link.consent && (
                <ul className="space-y-1">
                  {link.consent.lists.map((list) => (
                    <li key={list.id} className="flex flex-wrap items-center gap-2">
                      <bdi>{list.name}</bdi>
                      <span className="text-muted-foreground">
                        {L.membership[list.subscriptionStatus]}
                      </span>
                      {list.status === "archived" && <Badge variant="outline">{L.archived}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
              {link.state === "verified" && link.consent === null && (
                <p className="text-muted-foreground">{L.detailsUnavailable}</p>
              )}
              {onAction !== undefined && (
                <PersonNewsletterLinkControls
                  link={link}
                  address={row.address}
                  summary={summary}
                  onAction={onAction}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {canVerify && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => onAction({ kind: "verify", address: row.address })}
        >
          {L.actions.verify}
        </Button>
      )}
    </section>
  );
}

export function PersonNewsletterPanel({
  personId,
  canManage,
  canCreateLead,
}: {
  personId: string;
  canManage: boolean;
  canCreateLead: boolean;
}) {
  const L = personNewsletterMessages[useLocale()];
  const [action, setAction] = useState<PersonNewsletterAction | null>(null);
  const [notice, setNotice] = useState("");
  const utils = trpc.useUtils();
  const query = trpc.newsletter.identity.person.useQuery(
    { personId },
    { staleTime: 0, retry: false },
  );
  const summary = query.data?.personId === personId && !query.isError ? query.data : undefined;
  function refresh() {
    void query.refetch();
    void utils.contacts.contactTimeline.invalidate({ entityType: "person", entityId: personId });
  }
  if (query.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {L.loading}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={query.isFetching}
          onClick={refresh}
        >
          {L.retry}
        </Button>
        {summary?.engineAvailable !== true && (
          <p role="status" className="text-sm text-muted-foreground">
            {L.unavailable}
          </p>
        )}
        {notice !== "" && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
      </div>
      {summary?.addresses.length === 0 && (
        <p className="text-sm text-muted-foreground">{L.noAddresses}</p>
      )}
      {summary?.addresses.map((row) => (
        <PersonNewsletterAddress
          key={row.address}
          row={row}
          summary={summary}
          onAction={canManage && !query.isFetching ? setAction : undefined}
        />
      ))}
      {summary !== undefined && (
        <PersonNewsletterAttribution personId={personId} canCreateLead={canCreateLead} />
      )}
      {canManage && action !== null && (
        <PersonNewsletterActions
          action={action}
          personId={personId}
          onClose={() => setAction(null)}
          onResult={(result) => {
            setAction(null);
            setNotice(result.state === "suppressed" ? L.suppressed : L.actionSuccess);
            refresh();
          }}
        />
      )}
    </div>
  );
}
