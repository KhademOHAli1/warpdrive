import { z } from "zod";
import { env } from "@/config/env";
import { defineOperation } from "@/features/newsletter/operation";
import { audienceId, type ListSignupEmbed, listStatus, listType } from "./contracts";

const config = z.object({
  root_url: z.string(),
  public_subscription: z.object({ enabled: z.boolean(), captcha_enabled: z.boolean() }),
});
const exactList = z.object({ id: audienceId, uuid: z.uuid(), type: listType, status: listStatus });

export function safePublicOrigin(input: string): string | null {
  try {
    const url = new URL(input);
    if (
      input !== input.trim() ||
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function listSignupMarkup(origin: string, uuid: string): ListSignupEmbed {
  const url = new URL("/subscription/form", origin);
  url.searchParams.set("l", uuid);
  return {
    status: "ready",
    url: url.href,
    html: `<iframe src="${url.href}" title="Newsletter signup" width="100%" height="640" loading="lazy" referrerpolicy="no-referrer"></iframe>`,
  };
}

export const listSignupRead = defineOperation(
  z.strictObject({ id: audienceId }),
  async (client, { id }, context): Promise<ListSignupEmbed> => {
    if (!context.deliveryEnabled || !env.NEWSLETTER_PUBLIC_SIGNUP_ENABLED)
      return { status: "signupDisabled" };
    const origin = safePublicOrigin(env.NEWSLETTER_PUBLIC_ORIGIN);
    if (origin === null) return { status: "originMismatch" };
    if (!(await client.hasConsentContract())) return { status: "serviceUnsupported" };
    const [rawConfig, rawList] = await Promise.all([
      client.json("GET", "/api/config"),
      client.json("GET", `/api/lists/${id}`),
    ]);
    const settings = config.parse(rawConfig);
    const list = exactList.parse(rawList);
    if (list.id !== id || list.type !== "public" || list.status !== "active")
      return { status: "listUnavailable" };
    if (safePublicOrigin(settings.root_url) !== origin) return { status: "originMismatch" };
    if (!settings.public_subscription.enabled) return { status: "signupDisabled" };
    if (!settings.public_subscription.captcha_enabled) return { status: "verificationRequired" };
    return listSignupMarkup(origin, list.uuid);
  },
);
