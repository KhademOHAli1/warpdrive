import { z } from "zod";
import { revisionSchema } from "@/features/agency-projects/valueSchemas";
import { projectIdInput } from "../input";

export const joinPublicProjectInput = z.strictObject({
  projectId: projectIdInput,
  expectedActorId: projectIdInput,
  csrfToken: z.string().max(128).nullable(),
});

export const saveProjectGuestAccessInput = joinPublicProjectInput.extend({
  revision: revisionSchema,
  visibility: z.enum(["private", "workspace"]),
  guestViewAllFeatures: z.boolean(),
});

export type SaveProjectGuestAccess = z.infer<typeof saveProjectGuestAccessInput>;

export const inviteProjectGuestInput = joinPublicProjectInput.extend({
  email: z.string().trim().max(254).email(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((value) => !value.includes("\0") && !/\p{Cs}/u.test(value)),
  locale: z.enum(["en", "de", "fa"]),
});

export type InviteProjectGuest = z.infer<typeof inviteProjectGuestInput>;
export type ProjectGuestInvitation =
  | { outcome: "invited"; userId: string; invitationId: string }
  | { outcome: "email_unavailable" };
