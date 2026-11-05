"use client";

import type React from "react";
import type { BillingMessages } from "../messages";
import { billingErrorMessage } from "./types";

export function BillingErrorNotice({
  messages,
  code,
}: {
  messages: BillingMessages;
  code: string;
}): React.ReactNode {
  return (
    <p role="alert" className="text-sm text-destructive">
      {billingErrorMessage(messages, code)}
      {code === "fresh_auth_required" ? (
        <a className="ms-1 underline" href="/settings/security" target="_blank" rel="noreferrer">
          {messages.securityLink}
        </a>
      ) : null}
    </p>
  );
}
