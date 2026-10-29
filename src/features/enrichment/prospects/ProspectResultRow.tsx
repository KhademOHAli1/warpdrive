"use client";

import Link from "next/link";
import type React from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import { useEnrichmentMessages } from "../useEnrichmentMessages";
import type { BadgedProspect } from "./types";

export function ProspectResultRow({
  profile,
  checked,
  disabled,
  onCheckedChange,
}: {
  profile: BadgedProspect;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}): React.ReactNode {
  const E = useEnrichmentMessages();
  const S = E.prospects;
  const location = [profile.city, profile.country]
    .filter((part) => part !== undefined)
    .join(E.listSeparator);
  const held = profile.match.kind === "existing" ? profile.match : null;
  return (
    <tr className="border-border/60 border-b last:border-b-0">
      <td className="w-8 py-2 ps-3 align-middle">
        <Checkbox
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
          label={profile.fullName}
        />
      </td>
      <td className="py-2 ps-2 align-middle">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-foreground text-sm">{profile.fullName}</span>
          {held !== null ? (
            <Link
              href={`/contacts/people/${held.personId}`}
              className="text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
            >
              {S.alreadyHeld}
            </Link>
          ) : null}
        </div>
      </td>
      <td className="py-2 ps-3 align-middle text-muted-foreground text-sm">
        <bdi dir="auto">{profile.title ?? ""}</bdi>
      </td>
      <td className="py-2 ps-3 align-middle text-muted-foreground text-sm">
        <bdi dir="auto">{location}</bdi>
      </td>
      <td className="py-2 pe-3 ps-3 align-middle text-muted-foreground text-xs">
        {profile.hasEmail ? S.hasEmail : S.hasNothing}
      </td>
    </tr>
  );
}
