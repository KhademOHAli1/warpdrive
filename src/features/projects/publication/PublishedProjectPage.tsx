/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Adapted from Plane Community v1.5.0, apps/space/app/issues/[anchor]/page.tsx.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/Button";
import { getLocalePreferences } from "@/features/i18n/server";
import { BLOCK_CLASS } from "@/features/observability/replayMasking";
import { createContext } from "@/frontend/context";
import { cn } from "@/lib/utils";
import { ProjectBrandMark, ProjectCoverArt } from "../brand/ProjectBrand";
import {
  type ProjectPublicationLayout,
  type PublicProjectBoard,
  projectPublicationCoverPath,
  projectPublicationPath,
} from "./contracts";
import { publicationAnchorInput, publicationPageInput } from "./input";
import { publicationMessages } from "./messages";
import { PublicIntakePortal } from "./PublicIntakePortal";
import { readPublishedBoardFromCore } from "./webReads";

type Search = { view?: string | string[]; page?: string | string[] };
type Labels = (typeof publicationMessages)["en"];

function routeView(board: PublicProjectBoard, view: Search["view"]): ProjectPublicationLayout {
  if (view === "board" && board.boardEnabled) return "board";
  return board.listEnabled ? "list" : "board";
}

function boardHref(anchor: string, layout: ProjectPublicationLayout, page: number) {
  return `${projectPublicationPath(anchor)}?${new URLSearchParams({ view: layout, page: String(page) })}`;
}

export async function PublishedProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ anchor: string }>;
  searchParams: Promise<Search>;
}) {
  const anchor = publicationAnchorInput.safeParse((await params).anchor);
  if (!anchor.success) notFound();
  const search = await searchParams;
  const page = publicationPageInput.parse(
    typeof search.page === "string" ? search.page : undefined,
  );
  const [result, { locale }] = await Promise.all([
    readPublishedBoardFromCore(anchor.data, page),
    getLocalePreferences(),
  ]);
  if (!result.ok) notFound();
  const board = result.value;
  const labels = publicationMessages[locale];
  const view = routeView(board, search.view);
  const context = board.showIntake ? await createContext() : null;
  const actorId = context?.actor?.id ?? context?.projectGuest?.id ?? null;
  const returnTo = encodeURIComponent(boardHref(anchor.data, view, page));
  return (
    <main
      className={cn(
        "mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-10",
        BLOCK_CLASS,
        "ph-no-capture",
      )}
    >
      <header>
        {board.cover !== null && (
          <ProjectCoverArt
            cover={board.cover}
            imageSrc={
              board.cover.kind === "image"
                ? projectPublicationCoverPath(anchor.data, board.cover.value)
                : undefined
            }
            className="mb-5 h-36 overflow-hidden rounded-xl sm:h-44"
          />
        )}
        <div className="flex items-center gap-3">
          <ProjectBrandMark logo={board.logo} className="shrink-0" />
          <h1 className="min-w-0 wrap-anywhere text-2xl font-medium">
            <bdi>{board.title}</bdi>
          </h1>
        </div>
      </header>
      {board.showIntake &&
        (actorId === null ? (
          <Link href={`/login?returnTo=${returnTo}`} prefetch={false} className={buttonVariants()}>
            {board.acceptsRequests ? labels.signIn : labels.signInForRequests}
          </Link>
        ) : (
          <PublicIntakePortal
            key={`${anchor.data}:${actorId}`}
            anchor={anchor.data}
            actorId={actorId}
            acceptsRequests={board.acceptsRequests}
          />
        ))}
      <section aria-label={labels.publicBoard} className="space-y-4">
        <nav aria-label={labels.layouts} className="flex gap-2">
          {(["list", "board"] as const).map((layout) => {
            const available = layout === "list" ? board.listEnabled : board.boardEnabled;
            return available ? (
              <Link
                key={layout}
                href={boardHref(anchor.data, layout, page)}
                prefetch={false}
                aria-current={view === layout ? "page" : undefined}
                className={buttonVariants({
                  variant: view === layout ? "outline" : "ghost",
                  size: "sm",
                })}
              >
                {labels[layout]}
              </Link>
            ) : null;
          })}
        </nav>
        <PublishedItems board={board} view={view} labels={labels} />
        {(page > 1 || board.nextPage !== null) && (
          <div className="flex flex-wrap gap-2">
            {page > 1 && (
              <Link
                className={buttonVariants({ variant: "outline" })}
                prefetch={false}
                href={boardHref(anchor.data, view, page - 1)}
              >
                {labels.prev}
              </Link>
            )}
            {board.nextPage !== null && (
              <Link
                className={buttonVariants({ variant: "outline" })}
                prefetch={false}
                href={boardHref(anchor.data, view, board.nextPage)}
              >
                {labels.next}
              </Link>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function PublishedItems({
  board,
  view,
  labels,
}: {
  board: PublicProjectBoard;
  view: ProjectPublicationLayout;
  labels: Labels;
}) {
  if (!board.showWorkItems || board.items.length === 0)
    return (
      <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        {board.showWorkItems ? labels.empty : labels.unavailable}
      </p>
    );
  if (view === "list")
    return (
      <ul className="divide-y rounded-lg border bg-card">
        {board.items.map(({ key, title, stateId }) => (
          <li key={key} className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <bdi className="text-muted-foreground" dir="ltr">
              {key}
            </bdi>
            <bdi className="grow">{title}</bdi>
            <bdi className="text-muted-foreground">
              {board.states.find(({ id }) => id === stateId)?.name}
            </bdi>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="grid auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-3">
      {board.states.map((state) => (
        <section
          key={state.id}
          aria-label={state.name}
          className="rounded-lg border bg-muted/30 p-3"
        >
          <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: state.color }}
              aria-hidden="true"
            />
            <bdi>{state.name}</bdi>
          </h2>
          <ul className="space-y-2">
            {board.items
              .filter(({ stateId }) => stateId === state.id)
              .map(({ key, title }) => (
                <li key={key} className="rounded-md border bg-card p-3 text-sm">
                  <bdi dir="ltr" className="mb-1 block text-xs text-muted-foreground">
                    {key}
                  </bdi>
                  <bdi>{title}</bdi>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
