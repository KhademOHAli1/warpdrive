"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { Button } from "@/components/ui/Button";
import { useLocale } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { executeWarehouseAction } from "../actions";
import type { WarehouseResult } from "../contracts";
import { WarehouseWorkspaceView } from "./WarehouseWorkspaceView";
import { warehouseMessages } from "./warehouseMessages";

export function WarehouseLive({ actorId, result }: { actorId: string; result: WarehouseResult }) {
  const router = useRouter();
  const t = warehouseMessages[useLocale()];
  const [refreshing, startRefresh] = useTransition();
  const refresh = () => startRefresh(() => router.refresh());

  if (!result.ok) {
    return (
      <section aria-busy={refreshing}>
        <PageHeading
          title={t.title}
          crumbs={[{ label: t.inventory, href: "/inventory" }, { label: t.title }]}
        />
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <p role="alert" className="text-sm">
            {t[result.error]}
          </p>
          <Button size="sm" variant="outline" disabled={refreshing} onClick={refresh}>
            <RefreshCw aria-hidden="true" />
            {t.refresh}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <WarehouseWorkspaceView
      key={actorId}
      initial={result.value}
      submit={(command) => executeWarehouseAction(actorId, command, readCsrfToken())}
      refresh={refresh}
      refreshing={refreshing}
    />
  );
}
