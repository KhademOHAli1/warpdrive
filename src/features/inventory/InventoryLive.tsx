"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useLocalePreferences } from "@/features/i18n/LocaleProvider";
import { readCsrfToken } from "@/utils/csrfCookie";
import { executeInventoryAction } from "./actions";
import type { InventoryResult } from "./contracts";
import { InventoryClient } from "./ui/InventoryClient";
import { inventoryMessages } from "./ui/inventoryMessages";

export function InventoryLive({ actorId, result }: { actorId: string; result: InventoryResult }) {
  const router = useRouter();
  const { locale } = useLocalePreferences();
  const t = inventoryMessages[locale];
  if (!result.ok) {
    return (
      <section className="space-y-4">
        <h1 className="text-xl font-semibold">{t.inventory}</h1>
        <p role="alert">{result.error}</p>
        <Button variant="outline" onClick={() => router.refresh()}>
          {t.refreshOrders}
        </Button>
      </section>
    );
  }
  const initial = result.value;
  return (
    <InventoryClient
      initial={initial}
      submit={(command) =>
        executeInventoryAction(actorId, command, initial.deal?.id ?? null, readCsrfToken())
      }
    />
  );
}
