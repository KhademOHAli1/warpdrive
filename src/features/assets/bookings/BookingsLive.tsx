"use client";

import { useState } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import type { BookingsWorkspace } from "./contracts";
import { executeBookingFeedAction } from "./feedWebActions";
import type { BookingMembershipWorkspace } from "./membershipContracts";
import { executeBookingMembershipAction } from "./membershipWebActions";
import { BookingWorkspace } from "./ui/BookingWorkspace";
import { checkAvailabilityAction, executeBookingAction } from "./webActions";

export function BookingsLive({
  actorId,
  initial,
  canBrowseAssets,
  initialMemberships,
}: {
  actorId: string;
  initial: BookingsWorkspace;
  canBrowseAssets: boolean;
  initialMemberships?: BookingMembershipWorkspace;
}) {
  const [membershipSource, setMembershipSource] = useState(initialMemberships);
  const [memberships, setMemberships] = useState(initialMemberships);
  if (membershipSource !== initialMemberships) {
    setMembershipSource(initialMemberships);
    setMemberships(initialMemberships);
  }

  return (
    <BookingWorkspace
      initial={initial}
      fixture={false}
      canBrowseAssets={canBrowseAssets}
      submit={(command) => executeBookingAction(actorId, command, readCsrfToken())}
      checkAvailability={(input) => checkAvailabilityAction(actorId, input, readCsrfToken())}
      submitFeed={(input) => executeBookingFeedAction(actorId, input, readCsrfToken())}
      membershipAccess={
        memberships === undefined
          ? undefined
          : {
              workspace: memberships,
              submit: async (command) => {
                const result = await executeBookingMembershipAction(
                  actorId,
                  command,
                  readCsrfToken(),
                );
                if (result.ok) setMemberships(result.value);
                return result;
              },
            }
      }
    />
  );
}
