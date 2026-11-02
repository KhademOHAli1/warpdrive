import type { ComposerDraftSeed } from "../toComposerDraft";
import type { ComposerContext } from "./composer.types";
import type { ComposerMailbox } from "./composerMailbox.types";

export type ComposerDraft = Pick<ComposerDraftSeed, "id" | "subject" | "bodyHtml" | "to" | "cc"> &
  Partial<Omit<ComposerDraftSeed, "id" | "subject" | "bodyHtml" | "to" | "cc">>;
export interface ComposerProps {
  accountId: string;
  fromAddress?: string;
  mailboxes?: ComposerMailbox[];
  context?: ComposerContext;
  threadId?: string;
  linkDealId?: string;
  draft?: ComposerDraft;
  prefill?: { to?: string[]; cc?: string[]; subject?: string; bodyHtml?: string };
  onSent?: () => void;
  onClose?: () => void;
}
