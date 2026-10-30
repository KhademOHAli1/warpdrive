"use client";
import { createContext, useContext } from "react";

const MailboxContext = createContext(false);
export const InboxMailboxProvider = MailboxContext.Provider;
export function useInboxMailbox(): boolean {
  return useContext(MailboxContext);
}
