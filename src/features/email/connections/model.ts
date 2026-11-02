import type { Result } from "@/types/result";
import type {
  CheckedMailboxConnection,
  MailboxEndpointInput,
  MailboxSentCopyMode,
  SaveMailboxInput,
} from "./types";

export const DEFAULT_MAIL_HISTORY_DAYS = 90;
export const MAX_MAIL_HISTORY_DAYS = 3650;
const MAX_SERVER_PORT = 65_535;
const PERSIAN_ZERO = 0x6f0;
const ARABIC_ZERO = 0x660;

export interface EndpointDraft extends Omit<MailboxEndpointInput, "port"> {
  port: string;
}

export function initialEndpoint(
  kind: "imap" | "smtp",
  existing?: Omit<MailboxEndpointInput, "password">,
): EndpointDraft {
  if (existing !== undefined) return { ...existing, port: String(existing.port), password: "" };
  return {
    host: "",
    port: kind === "imap" ? "993" : "587",
    security: kind === "imap" ? "tls" : "starttls",
    username: "",
    password: "",
  };
}

export function positiveInteger(value: string, maximum: number): number | null {
  const normalized = value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - PERSIAN_ZERO))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - ARABIC_ZERO))
    .trim();
  if (!/^\d+$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isSafeInteger(number) && number > 0 && number <= maximum ? number : null;
}

export function endpointInput(value: EndpointDraft): MailboxEndpointInput | null {
  const port = positiveInteger(value.port, MAX_SERVER_PORT);
  if (port === null || !value.host.trim() || !value.username || !value.password) return null;
  return { ...value, port };
}

export function buildMailboxScope(input: {
  checked: CheckedMailboxConnection;
  folders: string[];
  days: string;
  isDefault: boolean;
  sentCopyMode: MailboxSentCopyMode;
  sentFolderPath: string;
}): Result<SaveMailboxInput, "folderRequired" | "invalidHistory" | "invalidSentFolder"> {
  const historyDays = positiveInteger(input.days, MAX_MAIL_HISTORY_DAYS);
  if (input.folders.length === 0) return { ok: false, error: "folderRequired" };
  if (historyDays === null) return { ok: false, error: "invalidHistory" };
  const sentCopyMode = input.checked.capabilities.send ? input.sentCopyMode : "crm_only";
  if (
    sentCopyMode === "append" &&
    !input.checked.folders.some(
      (folder) => folder.path === input.sentFolderPath && folder.readOnly !== true,
    )
  )
    return { ok: false, error: "invalidSentFolder" };
  return {
    ok: true,
    value: {
      checkId: input.checked.checkId,
      folderPaths: input.folders,
      historyDays,
      isDefault: input.isDefault,
      sentCopyMode,
      ...(sentCopyMode === "append" ? { sentFolderPath: input.sentFolderPath } : {}),
    },
  };
}
