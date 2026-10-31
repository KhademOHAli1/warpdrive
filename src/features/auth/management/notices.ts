import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { authMailLocale } from "@/features/auth/better/mailLocale";
import { enqueueAuthMail } from "./mail";

export type AdministrativeNotice = "admin_access" | "admin_sessions" | "operator_recovery";

// Call in the mutation transaction. The recipient's durable language wins over the operator's UI.
export async function enqueueUserSecurityNotice(
  db: Db,
  userId: string,
  detail: AdministrativeNotice,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (user === undefined) return;
  const locale = await authMailLocale(db, userId);
  signal.throwIfAborted();
  await enqueueAuthMail(
    db,
    { userId, recipient: user.email, locale, kind: "security_change", detail },
    signal,
  );
}
