"use client";
import { useEffect, useState } from "react";

export function useContactSearch() {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(draft.trim()), 250);
    return () => clearTimeout(timer);
  }, [draft]);
  return {
    draft,
    setDraft,
    search,
    settling: draft.trim() !== search,
    submit: () => setSearch(draft.trim()),
    clear: () => {
      setDraft("");
      setSearch("");
    },
  };
}
