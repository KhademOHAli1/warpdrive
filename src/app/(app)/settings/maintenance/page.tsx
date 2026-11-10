import { MaintenanceClient } from "@/features/newsletter/admin/MaintenanceClient";
import {
  newsletterMaintenanceDates,
  requireNewsletterAdmin,
} from "@/features/newsletter/admin/server";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";

export default async function CampaignMaintenancePage() {
  const L = await requireNewsletterAdmin();
  const dates = newsletterMaintenanceDates();
  return (
    <SettingsPage className="max-w-5xl">
      <SettingsHeading title={L.maintenance} description={L.maintenanceInfo} scope="workspace" />
      <MaintenanceClient {...dates} />
    </SettingsPage>
  );
}
