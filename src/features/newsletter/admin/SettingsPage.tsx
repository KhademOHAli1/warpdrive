import Link from "next/link";
import { SettingsHeading } from "@/app/(app)/settings/SettingsHeading";
import { SettingsPage } from "@/app/(app)/settings/SettingsSurface";
import { cn } from "@/lib/utils";
import { type SettingsSection, settingsSections } from "./contracts";
import { SettingsClient } from "./SettingsClient";
import { requireNewsletterAdmin } from "./server";

export async function CampaignSettingsPage({ section }: { section: SettingsSection }) {
  const L = await requireNewsletterAdmin();
  return (
    <SettingsPage className="max-w-5xl">
      <SettingsHeading title={L.settings} scope="workspace" />
      <nav className="flex flex-wrap gap-1 rounded-md border p-1" aria-label={L.settings}>
        {settingsSections.map((item) => (
          <Link
            key={item}
            href={item === "general" ? "/settings/campaigns" : `/settings/campaigns/${item}`}
            aria-current={item === section ? "page" : undefined}
            className={cn(
              "rounded px-3 py-1.5 text-sm transition-colors hover:bg-accent",
              item === section && "bg-accent font-semibold text-foreground",
            )}
          >
            {L.sections[item]}
          </Link>
        ))}
      </nav>
      <SettingsClient section={section} />
    </SettingsPage>
  );
}
