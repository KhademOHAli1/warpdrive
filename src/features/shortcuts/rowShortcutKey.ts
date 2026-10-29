// Character j/k remain portable across Latin layouts. For a non-Latin letter, use the same
// physical positions so a Persian layout does not disable row navigation. Dead/IME keys and
// other Latin characters do not acquire a second meaning; event guards live at the caller.
export function rowShortcutDirection(key: string, code: string): 1 | -1 | null {
  if (key === "j") return 1;
  if (key === "k") return -1;
  if (!/^\p{Letter}$/u.test(key) || /\p{Script=Latin}/u.test(key)) return null;
  if (code === "KeyJ") return 1;
  if (code === "KeyK") return -1;
  return null;
}
