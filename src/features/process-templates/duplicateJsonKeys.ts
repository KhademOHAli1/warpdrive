interface ObjectFrame {
  kind: "object";
  expectsKey: boolean;
  keys: Set<string>;
}

function visitObjectToken(frame: ObjectFrame, token: string): boolean {
  if (token === ",") {
    frame.expectsKey = true;
    return false;
  }
  if (token === ":") frame.expectsKey = false;
  if (!frame.expectsKey) return false;
  const key = JSON.parse(token) as string;
  const duplicate = frame.keys.has(key);
  frame.keys.add(key);
  frame.expectsKey = false;
  return duplicate;
}

// Call only after JSON.parse has established valid JSON syntax. Tokenizing strings
// preserves escaped quotes/braces and compares decoded Unicode key identities.
export function hasDuplicateJsonKeys(validJson: string): boolean {
  const frames: (ObjectFrame | { kind: "array" })[] = [];
  const tokens = validJson.matchAll(/"(?:\\.|[^"\\])*"|[{}[\],:]/g);
  for (const [token] of tokens) {
    if (token === "{") {
      frames.push({ kind: "object", expectsKey: true, keys: new Set() });
    } else if (token === "[") {
      frames.push({ kind: "array" });
    } else if (token === "}" || token === "]") {
      frames.pop();
    } else {
      const frame = frames.at(-1);
      if (frame?.kind !== "object") continue;
      if (visitObjectToken(frame, token)) return true;
    }
  }
  return false;
}
