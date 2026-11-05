"use client";
import { ProfileError } from "@/features/company-profile/ui/CommandFeedback";
import { WorkHub } from "@/features/work-profile/ui/WorkHub";
import { WorkScreen } from "@/features/work-profile/ui/WorkScreen";
export function WorkClient({ actorId }: { actorId: string }) {
  return (
    <WorkScreen key={actorId}>
      {(data) =>
        data.permissions.view ? (
          <WorkHub data={data} actorId={actorId} />
        ) : (
          <ProfileError code="forbidden" />
        )
      }
    </WorkScreen>
  );
}
