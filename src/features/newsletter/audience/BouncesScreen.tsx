"use client";

import { type FormEvent, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageHeading } from "@/components/shell/PageHeading";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useNewsletterRead, useNewsletterWrite } from "@/features/newsletter/ui/client";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { useFormatters } from "@/lib/useFormatters";
import {
  AudiencePagination,
  AudienceRefresh,
  AudienceTable,
  AudienceWriteError,
} from "./components";
import type { AudiencePage, Bounce } from "./contracts";
import { useAudienceMessages } from "./messages";

type Filters = { source: string; campaignId?: number };
const emptyFilters: Filters = { source: "" };

function BounceFilter({ initial, apply }: { initial: Filters; apply: (filters: Filters) => void }) {
  const L = useAudienceMessages();
  const [source, setSource] = useState(initial.source);
  const [campaignId, setCampaignId] = useState(initial.campaignId?.toString() ?? "");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply({
      source: source.trim(),
      campaignId: campaignId === "" ? undefined : Number(campaignId),
    });
  }

  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
      <Input
        className="w-40"
        aria-label={L.source}
        placeholder={L.source}
        value={source}
        maxLength={200}
        onChange={(event) => setSource(event.target.value)}
      />
      <Input
        className="w-40"
        aria-label={L.campaignId}
        placeholder={L.campaignId}
        type="number"
        min={1}
        max={2147483647}
        step={1}
        value={campaignId}
        onChange={(event) => setCampaignId(event.target.value)}
      />
      <Button variant="outline" type="submit">
        {L.apply}
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setSource("");
          setCampaignId("");
          apply(emptyFilters);
        }}
      >
        {L.reset}
      </Button>
    </form>
  );
}

export function BouncesScreen() {
  const L = useAudienceMessages();
  const format = useFormatters();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [deleting, setDeleting] = useState<number | null>(null);
  const read = useNewsletterRead<AudiencePage<Bounce>>("subscribers.bounces", { page, ...filters });
  const write = useNewsletterWrite();
  const rows = read.data?.results ?? [];

  function apply(value: Filters) {
    setFilters(value);
    setPage(1);
  }

  function remove() {
    if (deleting === null) return;
    void write
      .run("subscribers.deleteBounce", { id: deleting })
      .then(() => setPage(1))
      .catch(() => undefined);
  }

  return (
    <section className={`space-y-4 ${BLOCK_CLASS} ph-no-capture`}>
      <PageHeading title={L.bounces} actions={<AudienceRefresh read={read} />} />
      <BounceFilter key={JSON.stringify(filters)} initial={filters} apply={apply} />
      <AudienceWriteError error={write.error} />
      <AudienceTable
        labels={[L.email, L.campaign, L.source, L.type, L.received, L.actions]}
        empty={L.emptyBounces}
        read={read}
        count={rows.length}
      >
        {rows.map((row) => (
          <tr key={row.id} className="hover:bg-muted/30">
            <td className="max-w-80 break-all px-4 py-3">
              <bdi dir="ltr">{row.email ?? L.noValue}</bdi>
            </td>
            <td className="px-4 py-3">
              {row.campaign ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => apply({ ...filters, campaignId: row.campaign?.id })}
                >
                  <bdi dir="auto" className="max-w-56 truncate">
                    {row.campaign.name}
                  </bdi>
                </Button>
              ) : (
                L.noValue
              )}
            </td>
            <td className="px-4 py-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => apply({ ...filters, source: row.source })}
              >
                <bdi dir="auto">{row.source}</bdi>
              </Button>
            </td>
            <td className="px-4 py-3">
              <Badge variant="secondary">{L[row.type]}</Badge>
            </td>
            <td className="whitespace-nowrap px-4 py-3">{format.dateTime(row.created_at)}</td>
            <td className="px-4 py-3">
              <Button
                variant="ghost"
                size="sm"
                disabled={write.isPending}
                onClick={() => setDeleting(row.id)}
              >
                {L.delete}
              </Button>
            </td>
          </tr>
        ))}
      </AudienceTable>
      <AudiencePagination
        page={page}
        total={read.data?.total ?? 0}
        busy={read.isFetching}
        onPageChange={setPage}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={L.deleteBounce}
        description={L.deleteBounceDetail}
        confirmLabel={L.delete}
        destructive
        pending={write.isPending}
        onConfirm={remove}
      />
    </section>
  );
}
