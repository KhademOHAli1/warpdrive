"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useNewsletterRead } from "@/features/newsletter/ui/client";
import { useFormatters } from "@/lib/useFormatters";
import { useCampaignMessages } from "./messages";
import {
  type AnalyticsMetric,
  type AnalyticsRow,
  analyticsMetric,
  type Campaign,
  type Page,
  safeNewsletterLink,
} from "./model";
import {
  CampaignHeading,
  cellClass,
  Field,
  headClass,
  Pager,
  panelClass,
  QueryState,
  tableClass,
} from "./ui";

interface CampaignChoice {
  id: number;
  name: string;
}
interface Report {
  ids: number[];
  from: string;
  to: string;
  type: AnalyticsMetric;
}
const colors = ["var(--link)", "#ac6b26", "#26a69a", "#805ad5", "#cb5379"];

function rangeDefaults() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 6);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function metricRows(rows: AnalyticsRow[], names: Map<number, string>) {
  const series = new Map<string, { timestamp: string } & Record<string, string | number>>();
  for (const row of rows) {
    if (!("timestamp" in row)) continue;
    const point = series.get(row.timestamp) ?? { timestamp: row.timestamp };
    point[`campaign${row.campaign_id}`] = row.count;
    series.set(row.timestamp, point);
  }
  const config: ChartConfig = {};
  [...names].forEach(([id, name], index) => {
    config[`campaign${id}`] = { label: name, color: colors[index % colors.length] };
  });
  return {
    points: [...series.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    config,
  };
}

function AnalyticsResults({ report, names }: { report: Report; names: Map<number, string> }) {
  const m = useCampaignMessages();
  const f = useFormatters();
  const query = useNewsletterRead<AnalyticsRow[]>("analytics.series", { ...report });
  const rows = query.data ?? [];
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const { config, points } = metricRows(rows, names);
  return (
    <div className={`${panelClass} grid gap-4 p-4`}>
      <QueryState
        loading={query.isLoading}
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
        empty={rows.length === 0 ? m.noAnalytics : undefined}
      >
        <div className="grid gap-4">
          <div>
            <h2 className="text-sm text-muted-foreground">{m[report.type]}</h2>
            <p className="text-2xl font-semibold tabular-nums">{f.number(total)}</p>
          </div>
          {report.type === "links" ? (
            <ChartContainer
              config={{ count: { label: m.count, color: "var(--link)" } }}
              aria-hidden="true"
              className="h-60 w-full"
            >
              <BarChart data={rows.slice(0, 20)}>
                <CartesianGrid vertical={false} />
                <YAxis tickLine={false} axisLine={false} width={48} />
                <XAxis dataKey="url" hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" />
              </BarChart>
            </ChartContainer>
          ) : (
            <ChartContainer config={config} aria-hidden="true" className="h-60 w-full">
              <LineChart data={points} margin={{ top: 4, right: 12 }}>
                <CartesianGrid vertical={false} />
                <YAxis tickLine={false} axisLine={false} width={48} />
                <XAxis
                  dataKey="timestamp"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                  tickFormatter={(value: string) =>
                    f.dateTime(value, { month: "short", day: "numeric" })
                  }
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent labelFormatter={(value) => f.dateTime(String(value))} />
                  }
                />
                {Object.keys(config).map((key) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={`var(--color-${key})`}
                    strokeWidth={2}
                    dot={points.length === 1}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
          )}
          <div className="max-h-80 overflow-auto rounded-md border">
            <table className={tableClass}>
              <thead className={headClass}>
                <tr>
                  <th scope="col" className={cellClass}>
                    {report.type === "links" ? m.link : m.campaigns}
                  </th>
                  {report.type !== "links" && (
                    <th scope="col" className={cellClass}>
                      {m.date}
                    </th>
                  )}
                  <th scope="col" className={cellClass}>
                    {m.count}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  if ("url" in row) {
                    const link = safeNewsletterLink(row.url);
                    return (
                      <tr className="border-b last:border-0" key={row.url}>
                        <td className={`${cellClass} max-w-lg break-all`}>
                          {link !== null ? (
                            <a
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-link hover:underline"
                            >
                              <bdi>{row.url}</bdi>
                            </a>
                          ) : (
                            <bdi>{row.url}</bdi>
                          )}
                        </td>
                        <td className={cellClass}>{f.number(row.count)}</td>
                      </tr>
                    );
                  }
                  return (
                    <tr
                      className="border-b last:border-0"
                      key={`${row.campaign_id}-${row.timestamp}`}
                    >
                      <td className={cellClass}>
                        <bdi>{names.get(row.campaign_id) ?? f.number(row.campaign_id)}</bdi>
                      </td>
                      <td className={cellClass}>{f.dateTime(row.timestamp)}</td>
                      <td className={cellClass}>{f.number(row.count)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </QueryState>
    </div>
  );
}

export function CampaignAnalytics({ initialId }: { initialId?: number }) {
  const m = useCampaignMessages();
  const [range, setRange] = useState(rangeDefaults);
  const [metric, setMetric] = useState<AnalyticsMetric>("views");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<CampaignChoice[]>(() =>
    initialId !== undefined ? [{ id: initialId, name: "" }] : [],
  );
  const [report, setReport] = useState<Report | null>(() =>
    initialId !== undefined ? { ids: [initialId], ...rangeDefaults(), type: "views" } : null,
  );
  const query = useNewsletterRead<Page<Campaign>>("campaigns.list", { search: filter, page });
  const initial = useNewsletterRead<Campaign>(
    "campaigns.detail",
    { id: initialId },
    initialId !== undefined,
  );
  const rows = query.data?.results ?? [];
  const selected = selection.map((item) =>
    item.name ? item : { ...item, name: initial.data?.name ?? `#${item.id}` },
  );
  const choices = [...rows, ...selected.filter((item) => !rows.some((row) => row.id === item.id))];
  const [reportNames, setReportNames] = useState<CampaignChoice[]>([]);
  const names = new Map(
    (reportNames.length ? reportNames : selected).map(({ id, name }) => [id, name]),
  );

  return (
    <section className="mx-auto max-w-screen-xl space-y-4 p-4 sm:p-6">
      <CampaignHeading title={m.analytics} />
      <form
        className={`${panelClass} grid gap-4 p-4`}
        onSubmit={(event) => {
          event.preventDefault();
          if (selection.length === 0 || range.from > range.to) return;
          setReportNames(selected);
          setReport({ ids: selected.map((item) => item.id), ...range, type: metric });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={m.startDate} htmlFor="campaign-report-from">
            <Input
              id="campaign-report-from"
              type="date"
              required
              value={range.from}
              max={range.to}
              onChange={(event) => setRange({ ...range, from: event.target.value })}
            />
          </Field>
          <Field label={m.endDate} htmlFor="campaign-report-to">
            <Input
              id="campaign-report-to"
              type="date"
              required
              value={range.to}
              min={range.from}
              onChange={(event) => setRange({ ...range, to: event.target.value })}
            />
          </Field>
          <div className="grid gap-1.5 text-sm font-medium">
            <p>{m.metric}</p>
            <Select
              value={metric}
              ariaLabel={m.metric}
              onChange={(value) => {
                const parsed = analyticsMetric.safeParse(value);
                if (parsed.success) setMetric(parsed.data);
              }}
              options={analyticsMetric.options.map((value) => ({ value, label: m[value] }))}
            />
          </div>
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">{m.chooseCampaigns}</legend>
          <Input
            className="max-w-xs"
            aria-label={m.searchCampaigns}
            placeholder={m.searchCampaigns}
            value={filter}
            maxLength={200}
            onChange={(event) => {
              setPage(1);
              setFilter(event.target.value);
            }}
          />
          <QueryState
            loading={query.isLoading}
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
            empty={choices.length === 0 ? m.noCampaigns : undefined}
          >
            <div className="grid max-h-48 gap-2 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
              {choices.map((item) => {
                const checked = selected.some((campaign) => campaign.id === item.id);
                return (
                  <label
                    key={item.id}
                    htmlFor={`report-campaign-${item.id}`}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={`report-campaign-${item.id}`}
                      label={item.name}
                      checked={checked}
                      disabled={!checked && selected.length >= 20}
                      onCheckedChange={(next) =>
                        setSelection(
                          next
                            ? [...selection, { id: item.id, name: item.name }]
                            : selection.filter((campaign) => campaign.id !== item.id),
                        )
                      }
                    />
                    <bdi>{item.name}</bdi>
                  </label>
                );
              })}
            </div>
          </QueryState>
          <Pager
            page={page}
            perPage={query.data?.per_page ?? 25}
            total={query.data?.total ?? 0}
            onChange={setPage}
          />
        </fieldset>
        <Button
          className="w-fit"
          type="submit"
          disabled={selected.length === 0 || !range.from || !range.to || range.from > range.to}
        >
          {m.report}
        </Button>
      </form>
      {report && <AnalyticsResults report={report} names={names} />}
    </section>
  );
}
