type MessageTree = { [key: string]: string | MessageTree };
type TranslationTree<T> = {
  [Key in keyof T]?: T[Key] extends string ? string : TranslationTree<T[Key]>;
};

export function mergeMessages<Tree extends MessageTree>(
  defaults: Tree,
  translated: TranslationTree<Tree>,
): Tree {
  const result: MessageTree = {};
  for (const [key, value] of Object.entries(defaults)) {
    const candidate = translated[key];
    if (typeof value === "string") {
      result[key] = typeof candidate === "string" && candidate.trim() !== "" ? candidate : value;
    } else {
      result[key] = mergeMessages(value, typeof candidate === "object" ? candidate : {});
    }
  }
  // Only keys from defaults are retained, and every leaf is filled with a string.
  return result as Tree;
}
