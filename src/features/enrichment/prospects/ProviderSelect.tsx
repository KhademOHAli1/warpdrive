"use client";

import type React from "react";
import { Select } from "@/components/ui/Select";
import { PROVIDER_NAMES as NAMES } from "../enrichmentMessages";
import { ENRICHMENT_PROVIDER_IDS, type ProviderId } from "../providers/types";
import { useEnrichmentMessages } from "../useEnrichmentMessages";

function isProviderId(value: string): value is ProviderId {
  return (ENRICHMENT_PROVIDER_IDS as readonly string[]).includes(value);
}

export function ProviderSelect({
  value,
  providers,
  onChange,
}: {
  value: ProviderId;
  providers: readonly ProviderId[];
  onChange: (provider: ProviderId) => void;
}): React.ReactNode {
  const E = useEnrichmentMessages();
  const S = E.prospects;
  return (
    <div className="flex min-w-40 flex-col gap-1">
      <span className="text-muted-foreground text-xs">{S.providerLabel}</span>
      <Select
        value={value}
        ariaLabel={S.providerLabel}
        options={providers.map((provider) => ({ value: provider, label: NAMES[provider] }))}
        onChange={(next) => {
          if (isProviderId(next)) onChange(next);
        }}
      />
    </div>
  );
}
