"use client";

import { useState } from "react";

interface RowKeys {
  keys: number[];
  nextKey: number;
}

function resizeRows(rows: RowKeys, length: number): RowKeys {
  const additional = Math.max(0, length - rows.keys.length);
  return {
    keys: [
      ...rows.keys.slice(0, length),
      ...Array.from({ length: additional }, (_, offset) => rows.nextKey + offset),
    ],
    nextKey: rows.nextKey + additional,
  };
}

// Draft schemas do not persist row IDs. Keep input identity across edits and removals.
export function useDraftRowKeys(length: number) {
  const [rows, setRows] = useState(() => resizeRows({ keys: [], nextKey: 0 }, length));
  const current = rows.keys.length === length ? rows : resizeRows(rows, length);
  if (current !== rows) setRows(current);

  function remove(index: number) {
    setRows((previous) => ({
      ...previous,
      keys: previous.keys.filter((_, position) => position !== index),
    }));
  }

  return { keys: current.keys, remove };
}
