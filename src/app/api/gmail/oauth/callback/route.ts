import { db } from "@/db/client";
import { createGmailOAuthCallback } from "@/features/email/oauthCallback";
import { gmailOAuthProvider } from "@/features/email/oauthProvider";
import { enqueueInitialSync } from "@/features/email/syncScheduling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createGmailOAuthCallback(db, {
  ...gmailOAuthProvider,
  enqueue: enqueueInitialSync,
});
