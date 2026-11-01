import { err, ok, type Result } from "@/types/result";

type JsonIngressError = "invalid_request" | "invalid_target";
const MAXIMUM_JSON_DEPTH = 32;

// Inspect syntax and decoded root keys before native parsing can discard duplicate members.
class ResourceJsonScanner {
  private index = 0;
  private resourceCount = 0;
  private invalidTarget = false;
  private readonly number = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

  constructor(private readonly text: string) {}

  scan(): Result<void, JsonIngressError> {
    this.space();
    if (this.text[this.index] !== "{" || !this.object(1, true)) return err("invalid_request");
    this.space();
    if (this.index !== this.text.length) return err("invalid_request");
    if (this.resourceCount !== 1 || this.invalidTarget) return err("invalid_target");
    return ok(undefined);
  }

  private space(): void {
    while (" \t\r\n".includes(this.text[this.index] ?? "\u0000")) this.index += 1;
  }

  private string(): string | undefined {
    if (this.text[this.index] !== '"') return undefined;
    const start = this.index++;
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      if (character === '"') {
        this.index += 1;
        try {
          const value: unknown = JSON.parse(this.text.slice(start, this.index));
          return typeof value === "string" ? value : undefined;
        } catch {
          return undefined;
        }
      }
      this.index += character === "\\" ? 2 : 1;
    }
    return undefined;
  }

  private target(depth: number): boolean {
    this.resourceCount += 1;
    this.space();
    if (this.text[this.index] !== '"') {
      this.invalidTarget = true;
      return this.value(depth);
    }
    const value = this.string();
    if (value === undefined) return false;
    if (value.length === 0) this.invalidTarget = true;
    return true;
  }

  private object(depth: number, root = false): boolean {
    if (depth > MAXIMUM_JSON_DEPTH) return false;
    this.index += 1;
    this.space();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return true;
    }
    while (this.index < this.text.length) {
      if (!this.member(depth, root)) return false;
      this.space();
      const separator = this.text[this.index++];
      if (separator === "}") return true;
      if (separator !== ",") return false;
      this.space();
    }
    return false;
  }

  private member(depth: number, root: boolean): boolean {
    const key = this.string();
    if (key === undefined) return false;
    this.space();
    if (this.text[this.index++] !== ":") return false;
    return root && key === "resource" ? this.target(depth + 1) : this.value(depth + 1);
  }

  private array(depth: number): boolean {
    if (depth > MAXIMUM_JSON_DEPTH) return false;
    this.index += 1;
    this.space();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return true;
    }
    while (this.index < this.text.length) {
      if (!this.value(depth + 1)) return false;
      this.space();
      const separator = this.text[this.index++];
      if (separator === "]") return true;
      if (separator !== ",") return false;
    }
    return false;
  }

  private value(depth: number): boolean {
    this.space();
    const character = this.text[this.index];
    if (character === '"') return this.string() !== undefined;
    if (character === "{") return this.object(depth);
    if (character === "[") return this.array(depth);
    for (const literal of ["true", "false", "null"]) {
      if (this.text.startsWith(literal, this.index)) {
        this.index += literal.length;
        return true;
      }
    }
    this.number.lastIndex = this.index;
    const matched = this.number.exec(this.text);
    if (matched === null) return false;
    this.index = this.number.lastIndex;
    return true;
  }
}

export function jsonResourceInput(text: string): Result<unknown, JsonIngressError> {
  const inspected = new ResourceJsonScanner(text).scan();
  if (!inspected.ok) return inspected;
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch {
    return err("invalid_request");
  }
}
