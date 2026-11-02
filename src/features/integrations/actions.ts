"use server";

import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { env } from "@/config/env";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { db } from "@/db/client";
import { integrationConnections, integrationEvents } from "@/db/schema/integrations";
import { resolveWorkflowSession } from "@/features/auth/better/sessionPolicy";
import { guardCsrf } from "@/features/identity/actions/shared";
import {
  beginSlackConnection,
  disconnectSlack,
  INTEGRATION_STATE_COOKIE,
  withSlackConnection,
} from "./service";
import { listSlackChannels, slackRequest } from "./slack";

type IntegrationResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function authenticated<T>(
  csrf: string | null,
  run: (actorId: string, sessionId: string) => Promise<T>,
): Promise<IntegrationResult<T>> {
  if (!(await guardCsrf(csrf)).ok) return { ok: false, error: "forbidden" };
  const current = await resolveWorkflowSession(
    db,
    new Headers(await headers()),
    AbortSignal.timeout(5000),
    { requireFresh: true },
  );
  if (!current) return { ok: false, error: "freshAuthentication" };
  try {
    return { ok: true, value: await run(current.user.id, current.session.id) };
  } catch {
    return { ok: false, error: "requestFailed" };
  }
}

export async function connectSlackAction(csrf: string | null) {
  return authenticated(csrf, async (actorId, sessionId) => {
    const connection = await beginSlackConnection(db, actorId, sessionId);
    (await cookies()).set(INTEGRATION_STATE_COOKIE, connection.state, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/integrations/slack",
      maxAge: 600,
    });
    return { url: connection.url };
  });
}

export async function slackChannelsAction(csrf: string | null, id: unknown) {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false as const, error: "requestFailed" };
  return authenticated(csrf, (actorId) =>
    withSlackConnection(db, actorId, parsed.data, listSlackChannels),
  );
}

export async function configureSlackAction(csrf: string | null, input: unknown) {
  const parsed = z
    .object({ id: z.uuid(), channelId: z.string().regex(/^[A-Z0-9]{4,30}$/) })
    .safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "requestFailed" };
  return authenticated(csrf, async (actorId) => {
    const channels = await withSlackConnection(db, actorId, parsed.data.id, listSlackChannels);
    const channel = channels.find((channel) => channel.id === parsed.data.channelId);
    if (!channel) throw new AppError(ERROR_IDS.CHANNEL_UNAVAILABLE, "channel_unavailable", {});
    await db.transaction(async (tx) => {
      await tx
        .update(integrationConnections)
        .set({
          settings: { channelId: channel.id, channelName: channel.name },
          updatedAt: new Date(),
        })
        .where(eq(integrationConnections.id, parsed.data.id));
      await tx
        .insert(integrationEvents)
        .values({ connectionId: parsed.data.id, actorId, action: "configured" });
    });
    return true;
  });
}

export async function testSlackAction(csrf: string | null, id: unknown) {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false as const, error: "requestFailed" };
  return authenticated(csrf, async (actorId) => {
    await withSlackConnection(db, actorId, parsed.data, (token) =>
      slackRequest("auth.test", token),
    );
    await db
      .update(integrationConnections)
      .set({ lastCheckedAt: new Date() })
      .where(eq(integrationConnections.id, parsed.data));
    return true;
  });
}

export async function disconnectSlackAction(csrf: string | null, id: unknown) {
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false as const, error: "requestFailed" };
  return authenticated(csrf, (actorId) => disconnectSlack(db, actorId, parsed.data));
}
