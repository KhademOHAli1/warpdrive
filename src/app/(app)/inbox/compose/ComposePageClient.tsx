"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Composer } from "@/features/email/Composer";
import { ComposeLinkSidebar } from "@/features/email/composer/ComposeLinkSidebar";
import type { ComposerMailbox } from "@/features/email/composer/composerMailbox.types";
import { useComposerMailboxMessages } from "@/features/email/composer/useComposerMailboxMessages";
import { toComposerDraft } from "@/features/email/toComposerDraft";
import { useEmailMessages } from "@/features/email/useEmailMessages";
import { useInboxRealtime } from "@/features/email/useInboxRealtime";
import { trpc } from "@/lib/trpc-client";

interface ComposePageClientProps {
  accountId: string;
  mailboxes?: ComposerMailbox[];
  fromAddress: string;
  selfActorId: string;
  draftId?: string;
}

// Full-pane compose route (Pipedrive parity): a Back bar over a two-column layout, the compose
// pane on the left and the deal-linking sidebar (ComposeLinkSidebar) on the right. Draft resume
// (?draft=<id>) has no dedicated by-id backend read, so it reuses the same drafts.list query the
// Drafts folder already fetches and matches client-side.
export function ComposePageClient({
  accountId,
  fromAddress,
  mailboxes,
  selfActorId,
  draftId,
}: ComposePageClientProps): React.ReactNode {
  const E = useEmailMessages();
  const L = useComposerMailboxMessages();

  const router = useRouter();
  // Opening compose unmounts InboxListClient (the full pane replaces the list), which would close
  // its realtime subscription. Keep it alive here so mail arriving during a compose session still
  // invalidates the inbox cache, exactly as the thread route does.
  useInboxRealtime({ selfActorId });
  // Only fetch the draft list when actually resuming a draft (?draft=<id>). A plain compose has no
  // draft to seed, and fetching here would cache a drafts list that autosave then mutates via a
  // server action without invalidating, hiding the new draft on a return to the Drafts folder
  // inside the stale window.
  const draftsQuery = trpc.email.drafts.list.useQuery(undefined, {
    enabled: draftId !== undefined,
  });
  const resumeDraft = draftsQuery.data?.find((d) => d.id === draftId);
  // Wait for the saved row before mounting editable state. A failed or missing resume
  // stays separate from a fresh compose so its account/content can never be silently replaced.
  const waitingForDraft =
    draftId !== undefined && draftsQuery.data === undefined && !draftsQuery.isError;
  // Picked/created deal, lifted here (not into Composer) so it survives independent of the
  // compose form fields and can be threaded into Composer's linkDealId prop.
  const [linkedDeal, setLinkedDeal] = useState<{ id: string; title: string } | null>(null);

  function backToInbox(): void {
    router.push("/inbox");
  }

  return (
    <main aria-label={E.composeTitle} className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <Link
          href="/inbox"
          aria-label={E.backToInbox}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground transition-transform hover:bg-accent active:scale-[0.96]"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          {E.back}
        </Link>
        <h1 className="text-display font-[450] leading-tight tracking-tight">{E.composeTitle}</h1>
      </div>
      <div className="flex min-h-0 flex-1 items-start gap-6 overflow-y-auto p-4">
        <div className="flex min-w-0 flex-1 flex-col">
          {waitingForDraft ? (
            <p className="p-3 text-sm text-muted-foreground">{E.loadingDraft}</p>
          ) : draftId !== undefined && resumeDraft === undefined ? (
            <div role="alert" className="space-y-3 rounded-md border border-border p-3 text-sm">
              <p>{draftsQuery.isError ? L.draftLoadingError : L.draftMissing}</p>
              {draftsQuery.isError && (
                <Button variant="outline" size="sm" onClick={() => void draftsQuery.refetch()}>
                  {L.retry}
                </Button>
              )}
              <Link href="/inbox" className="block text-action hover:underline">
                {L.openInbox}
              </Link>
            </div>
          ) : (
            <Composer
              key={resumeDraft?.id ?? "new-email"}
              accountId={resumeDraft?.accountId ?? accountId}
              fromAddress={
                resumeDraft === undefined || resumeDraft.accountId === accountId
                  ? fromAddress
                  : mailboxes?.find((mailbox) => mailbox.id === resumeDraft.accountId)?.emailAddress
              }
              mailboxes={mailboxes}
              draft={resumeDraft !== undefined ? toComposerDraft(resumeDraft) : undefined}
              linkDealId={linkedDeal?.id}
              onSent={backToInbox}
              onClose={backToInbox}
            />
          )}
        </div>
        <div className="hidden w-[280px] shrink-0 lg:block">
          <ComposeLinkSidebar
            dealId={linkedDeal?.id ?? null}
            dealTitle={linkedDeal?.title ?? null}
            onLink={(id, title) => setLinkedDeal({ id, title })}
            onUnlink={() => setLinkedDeal(null)}
          />
        </div>
      </div>
    </main>
  );
}
