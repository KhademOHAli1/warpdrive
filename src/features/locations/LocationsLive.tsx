"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { executeLocationsAction } from "./actions";
import type { LocationsResult } from "./contracts";
import { LocationsDirectory } from "./LocationsDirectory";
import { locationsMessages } from "./locationsMessages";

export function LocationsLive({
  actorId,
  result,
  initialLocationId,
}: {
  actorId: string;
  result: LocationsResult;
  initialLocationId?: string;
}) {
  const router = useRouter();
  const locale = useLocale();
  const t = locationsMessages[locale];
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());
  if (!result.ok) {
    return (
      <section aria-busy={refreshing}>
        <PageHeading title={t.title} />
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <p role="alert" className="text-sm">
            {t[result.error]}
          </p>
          <Button variant="outline" disabled={refreshing} onClick={refresh}>
            {t.refreshDirectory}
          </Button>
        </div>
      </section>
    );
  }
  return (
    <LocationsDirectory
      key={actorId}
      initial={result.value}
      initialLocationId={initialLocationId}
      submit={(command) => executeLocationsAction(actorId, command, readCsrfToken())}
      refresh={refresh}
      refreshing={refreshing}
    />
  );
}
