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
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}): React.ReactNode {
  const L = useSettingsMessages();

  return (
    <PageHeading
      crumbs={[{ label: L._extra.settingsNav, href: "/settings" }, { label: title }]}
      title={title}
      description={description}
      actions={actions}
    />
  );
}
