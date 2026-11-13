"use client";

import { useStaticSearch } from "fumadocs-core/search/client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, type SubmitEvent } from "react";
import { SEARCH_INDEX_URL } from "@/lib/site";

export function SearchPage() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  const { search, onSearchChange, data, isLoading, error } = useStaticSearch({
    from: SEARCH_INDEX_URL,
  });

  useEffect(() => {
    onSearchChange(query);
  }, [query, onSearchChange]);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = search.trim();
    const href = value ? `/search/?${new URLSearchParams({ q: value })}` : "/search/";
    window.history.replaceState(null, "", href);
    onSearchChange(value);
  }

  const items =
    data?.query === search
      ? data.items.flatMap((item) => (item.type === "table" ? item.rows : [item]))
      : [];

  return (
    <>
      <form className="not-prose flex flex-wrap gap-2" action="/search/" onSubmit={submit}>
        <label className="sr-only" htmlFor="search-query">
          Search documentation
        </label>
        <input
          id="search-query"
          name="q"
          type="search"
          value={search}
          placeholder="Search the guides"
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          className="min-w-40 flex-1 rounded-lg border bg-fd-background px-3 py-2"
        />
        <button
          type="submit"
          className="rounded-lg bg-fd-primary px-4 py-2 font-medium text-fd-primary-foreground"
        >
          Search
        </button>
      </form>
      <div role="status" aria-live="polite">
        {error ? (
          <p>Search could not load. Reload the page to try again.</p>
        ) : isLoading ? (
          <p>Searching…</p>
        ) : search.trim() && items.length === 0 ? (
          <p>No matching guides.</p>
        ) : null}
      </div>
      {items.length > 0 && (
        <ul className="not-prose divide-y">
          {items.map((item) => (
            <li className="py-3" key={item.id}>
              {item.breadcrumbs && (
                <p className="mb-1 text-sm text-fd-muted-foreground">
                  {item.breadcrumbs.join(" / ")}
                </p>
              )}
              <Link href={item.url} className="text-fd-primary hover:underline">
                {item.content}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
