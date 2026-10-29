"use client";

import type React from "react";
import { useAppTranslations } from "@/features/i18n/LocaleProvider";

// Phase 1 stub: a polite live region for the reconnect state (UI spec 9.4). The WS client
// wiring that toggles visible lands with the board in Phase 2.
export function ReconnectBanner({ visible = false }: { visible?: boolean }): React.ReactNode {
  const t = useAppTranslations("shell");
  if (visible === false) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-warning px-4 py-1 text-center text-xs text-warning-foreground"
    >
      {t("reconnecting")}
    </div>
  );
}
