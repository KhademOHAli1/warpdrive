"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readCsrfToken } from "@/utils/csrfCookie";
import {
  configureSlackAction,
  disconnectSlackAction,
  slackChannelsAction,
  testSlackAction,
} from "./actions";
import type { ServiceConnectionView } from "./SlackConnection";

export function useSlackConnection(connection: ServiceConnectionView) {
  const router = useRouter();
  const [channels, setChannels] = useState<{ id: string; name: string }[] | null>(null);
  const [channelId, setChannelId] = useState(connection.settings.channelId ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<
    | "checked"
    | "saved"
    | "requestFailed"
    | "freshAuthentication"
    | "forbidden"
    | "revocationPending"
    | null
  >(null);

  function actionError(error: string) {
    setMessage(
      error === "freshAuthentication"
        ? "freshAuthentication"
        : error === "forbidden"
          ? "forbidden"
          : "requestFailed",
    );
  }

  async function run(action: "channels" | "save" | "check" | "disconnect") {
    setPending(true);
    setMessage(null);
    try {
      const csrf = readCsrfToken();
      if (action === "channels") {
        const result = await slackChannelsAction(csrf, connection.id);
        if (result.ok) setChannels(result.value);
        else actionError(result.error);
        return;
      }
      const operations = {
        save: () => configureSlackAction(csrf, { id: connection.id, channelId }),
        check: () => testSlackAction(csrf, connection.id),
        disconnect: () => disconnectSlackAction(csrf, connection.id),
      };
      const result = await operations[action]();
      if (!result.ok) {
        actionError(result.error);
        return;
      }
      if (action === "disconnect" && result.value === false) setMessage("revocationPending");
      if (action === "save") setMessage("saved");
      if (action === "check") setMessage("checked");
      router.refresh();
    } catch {
      setMessage("requestFailed");
    } finally {
      setPending(false);
    }
  }

  return { channels, channelId, setChannelId, pending, message, run };
}
