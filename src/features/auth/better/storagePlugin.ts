import type { BetterAuthPlugin } from "better-auth";

// Register private invitation storage with the native adapter so its conditional claim shares
// the same transaction as identity creation. There are no public invitation CRUD endpoints.
export const invitationStoragePlugin: BetterAuthPlugin = {
  id: "warpdrive-invitation-storage",
  schema: {
    invitation: {
      fields: {
        userId: { type: "string", required: true, input: false, returned: false },
        invitedBy: { type: "string", required: true, input: false, returned: false },
        email: { type: "string", required: true, input: false, returned: false },
        tokenHash: { type: "string", required: true, input: false, returned: false },
        acceptedAt: { type: "date", required: false, input: false, returned: false },
        revokedAt: { type: "date", required: false, input: false, returned: false },
        expiresAt: { type: "date", required: true, input: false, returned: false },
      },
    },
  },
};
