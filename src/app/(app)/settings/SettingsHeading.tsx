"use client";
import type React from "react";
import { PageHeading } from "@/components/shell/PageHeading";
import { useSettingsMessages } from "@/features/identity/useSettingsMessages";

// A settings page heading: the shared PageHeading with the "Settings / X" breadcrumb prepended, so
// every settings subpage carries the Pipedrive breadcrumb + 25px title without repeating the crumb.
export function SettingsHeading({
  title,
  description,
  actions,
  scope,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  scope?: "personal" | "workspace" | "mixed";
}): React.ReactNode {
  const L = useSettingsMessages();
  const scopeLabels = {
    personal: L._hierarchy.onlyYou,
    workspace: L._hierarchy.wholeWorkspace,
    mixed: L._hierarchy.personalShared,
  };

  return (
    <PageHeading
      crumbs={[{ label: L._extra.settingsNav, href: "/settings" }, { label: title }]}
      title={title}
      description={description}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {scope !== undefined && (
            <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
              {scopeLabels[scope]}
            </span>
          )}
          {actions}
        </div>
      }
    />
  );
}
