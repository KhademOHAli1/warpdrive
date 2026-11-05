"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SettingsPage } from "@/app/(app)/settings/SettingsSurface";
import { useWorkMessages } from "@/features/work-profile/messages";
import { PreferencesEditor } from "@/features/work-profile/ui/PreferencesEditor";
import { PresetInstaller } from "@/features/work-profile/ui/PresetInstaller";
import { TypeManager } from "@/features/work-profile/ui/TypeManager";
import { WorkScreen } from "@/features/work-profile/ui/WorkScreen";
export function WorkProfileClient({ actorId }: { actorId: string }) {
  const m = useWorkMessages();
  const router = useRouter();
  return (
    <WorkScreen key={actorId}>
      {(data, reload) => (
        <SettingsPage className="max-w-4xl space-y-8">
          <PreferencesEditor
            data={data}
            actorId={actorId}
            changed={() => {
              void reload();
              try {
                router.refresh();
              } catch {
                /* The work preferences are already saved. */
              }
            }}
            reload={reload}
          />
          <PresetInstaller data={data} actorId={actorId} changed={() => void reload()} />
          <TypeManager data={data} actorId={actorId} changed={() => void reload()} />
          {data.permissions.view ? (
            <Link href="/work" className="text-sm font-medium text-primary underline">
              {m.hubTitle}
            </Link>
          ) : null}
        </SettingsPage>
      )}
    </WorkScreen>
  );
}
