"use client";

import { useStaticSearch } from "fumadocs-core/search/client";
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogFooter,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import { RootProvider } from "fumadocs-ui/provider/next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SEARCH_INDEX_URL } from "@/lib/site";

function StaticSearchDialog(props: SharedProps) {
  const search = useStaticSearch({ from: SEARCH_INDEX_URL });
  const query = search.search.trim();
  const fullResults = query ? `/search/?${new URLSearchParams({ q: query })}` : "/search/";

  return (
    <SearchDialog {...props} {...search}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput aria-label="Search documentation" />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList />
        <SearchDialogFooter>
          <Link
            href={fullResults}
            className="text-sm text-fd-primary hover:underline"
            onClick={() => props.onOpenChange(false)}
          >
            Open full search
          </Link>
        </SearchDialogFooter>
      </SearchDialogContent>
    </SearchDialog>
  );
}

export function DocsProviders({ children }: { children: ReactNode }) {
  return (
    <RootProvider search={{ SearchDialog: StaticSearchDialog }} theme={{ hotKey: false }}>
      {children}
    </RootProvider>
  );
}
