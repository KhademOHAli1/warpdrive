/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Adapted from apps/web/components/profile/overview/stats.tsx in Plane Community
 * v1.5.0, commit 18caf808a3af3fcabeeba7d1e8473f1367bff2d4. The original is at
 * https://github.com/makeplane/plane/blob/18caf808a3af3fcabeeba7d1e8473f1367bff2d4/apps/web/components/profile/overview/stats.tsx.
 */

import { Bell, type LucideIcon, SquarePlus, UserRound } from "lucide-react";
import Link from "next/link";
import { type FormattingPreferences, formatNumber } from "@/lib/localeFormatting";
import { projectPriorities, projectStatuses } from "../contracts";
import { projectsTranslator } from "../ui/projectMessages";
import type { ProjectProfileSummary } from "./contracts";
import { projectProfileTranslator } from "./messages";
import { profileItemsPath } from "./paths";

type Props = {
  summary: ProjectProfileSummary;
  preferences: FormattingPreferences;
};

type Stat = { route: string; label: string; value: number };

function StatBreakdown({
  title,
  stats,
  preferences,
}: {
  title: string;
  stats: Stat[];
  preferences: FormattingPreferences;
}) {
  return (
    <section className="min-w-0 space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="divide-y rounded-lg border bg-card">
        {stats.map((stat) => (
          <li key={stat.route}>
            <Link
              href={stat.route}
              className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {stat.label}
              <span className="font-semibold tabular-nums">
                {formatNumber(stat.value, preferences)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProfileStats({ summary, preferences }: Props) {
  const { counts, createdCount, subscribedCount, priorityCounts } = summary;
  const { locale, numberingSystem } = preferences;
  const t = projectProfileTranslator(locale, numberingSystem);
  const project = projectsTranslator(locale, numberingSystem);

  const overviewCards: (Stat & { icon: LucideIcon })[] = [
    {
      icon: UserRound,
      route: profileItemsPath("assigned"),
      label: t("assigned"),
      value: projectStatuses.reduce((sum, status) => sum + counts[status], 0),
    },
    {
      icon: SquarePlus,
      route: profileItemsPath("created"),
      label: t("created"),
      value: createdCount,
    },
    {
      icon: Bell,
      route: profileItemsPath("subscribed"),
      label: t("subscribed"),
      value: subscribedCount,
    },
  ];

  return (
    <div className="@container space-y-4">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">{t("overview")}</h2>
        <div className="grid grid-cols-1 gap-3 @lg:grid-cols-3">
          {overviewCards.map((card) => (
            <Link
              key={card.route}
              href={card.route}
              className="min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="h-full min-w-0 rounded-lg border bg-card p-4 hover:bg-accent/40">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <card.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <p className="text-sm text-muted-foreground">{card.label}</p>
                  </div>
                  <p className="text-xl font-semibold tabular-nums">
                    {formatNumber(card.value, preferences)}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <div className="grid grid-cols-1 items-start gap-3 @xl:grid-cols-2">
        <StatBreakdown
          title={t("byStatus")}
          preferences={preferences}
          stats={projectStatuses.map((status) => ({
            route: profileItemsPath("assigned", { status }),
            label: project(`status.${status}`),
            value: counts[status],
          }))}
        />
        <StatBreakdown
          title={t("byPriority")}
          preferences={preferences}
          stats={projectPriorities.map((priority) => ({
            route: profileItemsPath("assigned", { priority }),
            label: project(`priority.${priority}`),
            value: priorityCounts[priority],
          }))}
        />
      </div>
    </div>
  );
}
