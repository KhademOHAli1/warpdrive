"use client";
import { cloneElement, type ReactElement, useId } from "react";
import { Tip } from "@/components/ui/tooltip";
import { useEmailMessages } from "./useEmailMessages";

export function MailOperationHint({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const E = useEmailMessages();
  const id = useId();
  return enabled ? (
    children
  ) : (
    <>
      <Tip label={E.remoteActions.unavailable}>
        <span className="inline-flex">{cloneElement(children, { "aria-describedby": id })}</span>
      </Tip>
      <span id={id} className="sr-only">
        {E.remoteActions.unavailable}
      </span>
    </>
  );
}
