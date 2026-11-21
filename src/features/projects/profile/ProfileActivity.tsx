/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Adapted from apps/web/components/profile/activity/activity-list.tsx
 * in Plane Community v1.5.0, commit 18caf808a3af3fcabeeba7d1e8473f1367bff2d4.
 */

import { PencilLine, SquarePlus } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { type FormattingPreferences, formatDateTime } from "@/lib/localeFormatting";
import type { ProfileActivityPage, ProfileCursor } from "./contracts";
import { projectProfileTranslator } from "./messages";
import { profileActivityPath, profileItemPath } from "./paths";

export function ProfileActivity({
  activity,
  cursor,
  preferences,
}: {
  activity: ProfileActivityPage;
  cursor: ProfileCursor | undefined;
  preferences: FormattingPreferences;
}) {
  const t = projectProfileTranslator(preferences.locale, preferences.numberingSystem);
  return (
    <div className="space-y-3">
      {activity.events.length === 0 ? (
        <EmptyState
          className="rounded-lg border bg-card"
          title={t("emptyActivity")}
          body={t("emptyActivityDescription")}
        />
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {activity.events.map((event) => {
            const Icon = event.kind === "created" ? SquarePlus : PencilLine;
            const label = t(event.kind === "created" ? "activityCreated" : "activityUpdated");
            return (
              <li key={event.id}>
                <Link
                  href={profileItemPath(event.item)}
                  className="flex items-start gap-3 rounded-md px-4 py-3 outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0 text-sm [overflow-wrap:anywhere]">
                      <span className="text-muted-foreground">{label}</span>{" "}
                      <bdi className="font-medium">{event.item.title}</bdi>
                      <bdi className="block text-muted-foreground">{event.item.project.title}</bdi>
                    </div>
                    <time dateTime={event.recordedAt} className="text-sm text-muted-foreground">
                      {formatDateTime(event.recordedAt, preferences)}
                    </time>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {cursor !== undefined || activity.nextCursor !== null ? (
        <nav aria-label={t("pagination")} className="flex flex-wrap items-center gap-4 text-sm">
          {cursor !== undefined && (
            <Link className="text-primary underline" href={profileActivityPath()}>
              {t("firstPage")}
            </Link>
          )}
          {activity.nextCursor !== null && (
            <Link
              className="text-primary underline"
              href={profileActivityPath(activity.nextCursor)}
            >
              {t("nextPage")}
            </Link>
          )}
        </nav>
      ) : null}
    </div>
  );
}
