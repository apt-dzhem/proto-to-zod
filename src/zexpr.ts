// A tiny builder for composing Zod expressions out of protoplugin `Printable`
// parts. An expression is an ordered list of printables (strings, import
// symbols, descriptor references) that protoplugin renders into source, wiring
// up imports automatically.

import type { ImportSymbol, Printable } from "@bufbuild/protoplugin";

/**
 * A composable Zod expression. Immutable-ish: chain calls mutate and return
 * `this` for fluent use, which is fine because each field builds a fresh one.
 */
export class ZodExpr {
  readonly parts: Printable[];

  constructor(parts: Printable[]) {
    this.parts = parts;
  }

  /** Start a fresh expression from the imported `z` symbol, e.g. `z.string()`. */
  static base(z: ImportSymbol, call: string): ZodExpr {
    return new ZodExpr([z, call]);
  }

  /** Start from an arbitrary printable (e.g. a reference to another schema). */
  static raw(...parts: Printable[]): ZodExpr {
    return new ZodExpr(parts);
  }

  /** Append a verbatim chunk such as `.min(3)`. */
  push(...parts: Printable[]): this {
    this.parts.push(...parts);
    return this;
  }

  /** Append a method call whose single argument is a literal string of source. */
  call(method: string, arg = ""): this {
    this.parts.push(`.${method}(${arg})`);
    return this;
  }

  /** Append a method call whose argument list contains printables. */
  callParts(method: string, args: Printable[]): this {
    this.parts.push(`.${method}(`);
    this.parts.push(...args);
    this.parts.push(")");
    return this;
  }

  /** `.optional()` */
  optional(): this {
    return this.call("optional");
  }

  /** Wrap the whole expression: `z.lazy(() => <expr>)`. */
  lazy(z: ImportSymbol): ZodExpr {
    return new ZodExpr([z, ".lazy(() => ", ...this.parts, ")"]);
  }

  toParts(): Printable[] {
    return this.parts;
  }
}

/** Render a JS string literal (single-quoted, escaped) as source text. */
export function jsString(value: string): string {
  return JSON.stringify(value);
}

/** Render a regex literal from an RE2/JS pattern string. */
export function jsRegex(pattern: string): string {
  // Use a RegExp constructor with a JSON-escaped string to avoid having to
  // escape `/` and to keep RE2 patterns byte-accurate.
  return `new RegExp(${jsString(pattern)})`;
}
