import { LogsClient } from "@/features/newsletter/admin/LogsClient";
import { ReceiptReview } from "@/features/newsletter/admin/ReceiptReview";
import { requireNewsletterAdmin } from "@/features/newsletter/admin/server";
import { SettingsHeading } from "../SettingsHeading";
import { SettingsPage } from "../SettingsSurface";

export default async function LogsPage() {
  const L = await requireNewsletterAdmin();
  return (
    <SettingsPage className="max-w-5xl">
      <SettingsHeading title={L.logs} description={L.logsInfo} scope="workspace" />
      <ReceiptReview />
      <LogsClient />
    </SettingsPage>
  );
}
