import { Plug } from "lucide-react";
import Image from "next/image";
import type { Integration } from "./catalog";

const brandIds = new Set([
  "chatgpt",
  "claude",
  "gmail",
  "slack",
  "google-calendar",
  "microsoft365",
  "zoom",
]);

export function IntegrationMark({ integration }: { integration: Integration }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-xs ring-1 ring-black/8"
    >
      {brandIds.has(integration.id) ? (
        <Image
          src={`/integrations/${integration.id}.svg`}
          width={24}
          height={24}
          alt=""
          className="size-6 object-contain"
        />
      ) : (
        <Plug className="size-6 text-neutral-600" />
      )}
    </span>
  );
}
