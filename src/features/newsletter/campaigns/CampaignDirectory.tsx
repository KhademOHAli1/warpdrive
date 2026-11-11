"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useWorkspaceShell } from "@/components/shell/WorkspaceShellProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useNewsletterRead, useNewsletterWrite } from "@/features/newsletter/ui/client";
import { useFormatters } from "@/lib/useFormatters";
import { useCampaignMessages } from "./messages";
import { type Campaign, type CampaignStatus, campaignStatus, type Page } from "./model";
import {
  ActionLink,
  CampaignHeading,
  cellClass,
  DeleteConfirmation,
  headClass,
  Pager,
  panelClass,
  QueryState,
  tableClass,
  WriteMessage,
} from "./ui";

export function CampaignDirectory() {
  const m = useCampaignMessages();
  const { campaignCapabilities } = useWorkspaceShell();
  const f = useFormatters();
  const router = useRouter();
  const write = useNewsletterWrite<{ id: number }>();
  const [checked, setChecked] = useState<number[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<CampaignStatus | "">("");
  const [page, setPage] = useState(1);
  const query = useNewsletterRead<Page<Campaign>>("campaigns.list", {
    page,
    search,
    ...(status ? { status } : {}),
  });
  const rows = query.data?.results ?? [];
  const selected = rows
    .filter((row) => canDelete(row) && checked.includes(row.id))
    .map((row) => row.id);
  function canDelete(row: Campaign) {
    return (
      row.started_at == null &&
      row.sent === 0 &&
      row.status !== "running" &&
      row.status !== "scheduled"
    );
  }

  function duplicate(row: Campaign) {
    const name = `${m.copyOf} ${row.name}`.slice(0, 255);
    void write
      .run("campaigns.clone", { id: row.id, name })
      .then((copy) => router.push(`/campaigns/${copy.id}`))
      .catch(() => undefined);
  }

  function deleteSelected() {
    if (selected.length === 0 || write.isPending) return;
    void write
      .run("campaigns.bulkDelete", { ids: selected, confirmed: true })
      .then(() => {
        setChecked([]);
        setDeleting(false);
      })
      .catch(() => undefined);
  }

  return (
    <section className="mx-auto max-w-screen-2xl p-4 sm:p-6">
      <CampaignHeading
        title={m.allCampaigns}
        actions={
          campaignCapabilities.edit ? (
            <ActionLink href="/campaigns/new">{m.newCampaign}</ActionLink>
          ) : undefined
        }
      />
      <div className={panelClass}>
        <form
          className="flex flex-wrap items-center gap-2 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(text.trim());
            setPage(1);
            setChecked([]);
          }}
        >
          <Input
            className="max-w-xs"
            aria-label={m.searchCampaigns}
            placeholder={m.searchCampaigns}
            value={text}
            maxLength={200}
            onChange={(event) => setText(event.target.value)}
          />
          <Button size="sm" variant="outline" type="submit">
            {m.search}
          </Button>
          <div className="min-w-36">
            <Select
              value={status}
              ariaLabel={m.status}
              onChange={(value) => {
                const parsed = campaignStatus.safeParse(value);
                setStatus(parsed.success ? parsed.data : "");
                setPage(1);
                setChecked([]);
              }}
              options={[
                { value: "", label: m.allStatuses },
                ...campaignStatus.options.map((value) => ({ value, label: m[value] })),
              ]}
            />
          </div>
        </form>
        {selected.length > 0 && (
          <div className="px-3 pb-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleting(true)}
              disabled={write.isPending}
            >
              {m.deleteSelected} ({selected.length})
            </Button>
          </div>
        )}
        <WriteMessage error={write.error} />
        <DeleteConfirmation
          open={deleting}
          onClose={() => setDeleting(false)}
          onConfirm={deleteSelected}
          pending={write.isPending}
        />
        <QueryState
          loading={query.isLoading}
          error={query.error}
          retry={() => {
            void query.refetch();
          }}
          empty={rows.length === 0 ? m.noCampaigns : undefined}
        >
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className={headClass}>
                <tr>
                  {campaignCapabilities.operate && (
                    <th scope="col" className={cellClass} aria-label={m.selectCampaign} />
                  )}
                  {[m.name, m.status, m.lists, m.sent, m.views, m.clicks, m.updated].map(
                    (column) => (
                      <th className={cellClass} scope="col" key={column}>
                        {column}
                      </th>
                    ),
                  )}
                  {campaignCapabilities.edit && (
                    <th scope="col" className={cellClass} aria-label={m.duplicateCampaign} />
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    {campaignCapabilities.operate && (
                      <td className={cellClass}>
                        <Checkbox
                          checked={selected.includes(row.id)}
                          disabled={!canDelete(row) || write.isPending}
                          label={`${m.selectCampaign} ${row.name}`}
                          onCheckedChange={(on) =>
                            setChecked((previous) =>
                              on ? [...previous, row.id] : previous.filter((id) => id !== row.id),
                            )
                          }
                        />
                      </td>
                    )}
                    <td className={cellClass}>
                      <Link
                        href={`/campaigns/${row.id}`}
                        className="font-medium text-link hover:underline"
                      >
                        <bdi>{row.name}</bdi>
                      </Link>
                      <div className="mt-0.5 max-w-72 truncate text-xs text-muted-foreground">
                        <bdi>{row.subject}</bdi>
                      </div>
                    </td>
                    <td className={cellClass}>
                      <Badge variant={row.status === "finished" ? "success" : "secondary"}>
                        {m[row.status]}
                      </Badge>
                    </td>
                    <td className={cellClass}>
                      <bdi>{row.lists.map((list) => list.name).join(", ") || m.noDate}</bdi>
                    </td>
                    <td className={cellClass}>
                      {f.number(row.sent)} / {f.number(row.to_send)}
                    </td>
                    <td className={cellClass}>{f.number(row.views)}</td>
                    <td className={cellClass}>{f.number(row.clicks)}</td>
                    <td className={cellClass}>
                      {row.updated_at !== null ? f.dateTime(row.updated_at) : m.noDate}
                    </td>
                    {campaignCapabilities.edit && (
                      <td className={cellClass}>
                        {row.type === "regular" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={write.isPending}
                            onClick={() => duplicate(row)}
                          >
                            {m.duplicateCampaign}
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
        <Pager
          page={page}
          perPage={query.data?.per_page ?? 25}
          total={query.data?.total ?? 0}
          onChange={(next) => {
            setPage(next);
            setChecked([]);
          }}
        />
      </div>
    </section>
  );
}
