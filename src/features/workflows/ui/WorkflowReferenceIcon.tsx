/*
 * Tabler Icons 3.41.1, the version pinned by Twenty v2.55.0.
 * https://github.com/tabler/tabler-icons/tree/v3.41.1/icons/outline
 *
 * MIT License
 * Copyright (c) 2020-2026 Paweł Kuna
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const PATHS = {
  "hand-move": [
    "M8 13v-8.5a1.5 1.5 0 0 1 3 0v7.5",
    "M11 11.5v-2a1.5 1.5 0 0 1 3 0v2.5",
    "M14 10.5a1.5 1.5 0 0 1 3 0v1.5",
    "M17 11.5a1.5 1.5 0 0 1 3 0v4.5a6 6 0 0 1 -6 6h-2h.208a6 6 0 0 1 -5.012 -2.7l-.196 -.3c-.312 -.479 -1.407 -2.388 -3.286 -5.728a1.5 1.5 0 0 1 .536 -2.022a1.867 1.867 0 0 1 2.28 .28l1.47 1.47",
    "M2.541 5.594a13.487 13.487 0 0 1 2.46 -1.427",
    "M14 3.458c1.32 .354 2.558 .902 3.685 1.612",
  ],
  "playlist-add": ["M19 8h-14", "M5 12h9", "M11 16h-6", "M15 16h6", "M18 13v6"],
  search: ["M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0", "M21 21l-6 -6"],
  "arrows-split": [
    "M21 17h-8l-3.5 -5h-6.5",
    "M21 7h-8l-3.495 5",
    "M18 10l3 -3l-3 -3",
    "M18 20l3 -3l-3 -3",
  ],
  "player-pause": [
    "M6 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12",
    "M14 6a1 1 0 0 1 1 -1h2a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-2a1 1 0 0 1 -1 -1l0 -12",
  ],
  "arrows-shuffle": [
    "M18 4l3 3l-3 3",
    "M18 20l3 -3l-3 -3",
    "M3 7h3a5 5 0 0 1 5 5a5 5 0 0 0 5 5h5",
    "M21 7h-5a4.978 4.978 0 0 0 -3 1m-4 8a4.984 4.984 0 0 1 -3 1h-3",
  ],
  forms: [
    "M12 3a3 3 0 0 0 -3 3v12a3 3 0 0 0 3 3",
    "M6 3a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3",
    "M13 7h7a1 1 0 0 1 1 1v8a1 1 0 0 1 -1 1h-7",
    "M5 7h-1a1 1 0 0 0 -1 1v8a1 1 0 0 0 1 1h1",
    "M17 12h.01",
    "M13 12h.01",
  ],
  "calendar-event": [
    "M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12",
    "M16 3l0 4",
    "M8 3l0 4",
    "M4 11l16 0",
    "M8 15h2v2h-2l0 -2",
  ],
  "mail-plus": [
    "M12 19h-7a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v5.5",
    "M16 19h6",
    "M19 16v6",
    "M3 7l9 6l9 -6",
  ],
  reload: ["M19.933 13.041a8 8 0 1 1 -9.925 -8.788c3.899 -1 7.935 1.007 9.425 4.747", "M20 4v5h-5"],
  plus: ["M12 5l0 14", "M5 12l14 0"],
  send: [
    "M10 14l11 -11",
    "M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5",
  ],
  "dots-vertical": [
    "M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    "M11 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    "M11 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
  ],
  pencil: ["M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4", "M13.5 6.5l4 4"],
  x: ["M18 6l-12 12", "M6 6l12 12"],
  "copy-plus": [
    "M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666",
    "M4.012 16.737a2 2 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1",
    "M11 14h6",
    "M14 11v6",
  ],
  filter: [
    "M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227",
  ],
  trash: [
    "M4 7l16 0",
    "M10 11l0 6",
    "M14 11l0 6",
    "M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12",
    "M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3",
  ],
} as const;

export type WorkflowReferenceIconName = keyof typeof PATHS;

export function WorkflowReferenceIcon({
  name,
  size = 16,
  stroke = 2,
  className,
}: {
  name: WorkflowReferenceIconName;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line no-restricted-syntax -- Render the exact licensed Tabler paths pinned to the Twenty workflow reference.
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name].map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}
