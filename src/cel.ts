// A deliberately small CEL → JavaScript transpiler. It handles the common,
// statically-reducible subset (cross-field comparisons, a few string macros).
// Anything outside the subset returns `null`, and the caller falls back to a
// comment or skips per the `cel` option.
//
// This is NOT a full CEL implementation. Full fidelity would require a runtime
// CEL evaluator (e.g. @bufbuild/cel) inside .superRefine(); see spec §6.1.

const METHOD_MAP: Record<string, string> = {
  "size()": "length",
  "lowerAscii()": "toLowerCase()",
  "upperAscii()": "toUpperCase()",
};

// Constructs we explicitly do not translate.
const UNSUPPORTED = [
  ".all(",
  ".exists(",
  ".existsOne(",
  ".map(",
  ".filter(",
  "has(",
  ".matches(",
  "?",
  "dyn(",
  "type(",
];

/**
 * Translate a CEL boolean expression into a JS expression over `v` (the value
 * bound to CEL's `this`). Returns null when the expression uses constructs
 * outside the supported subset.
 */
export function transpileCel(expr: string): string | null {
  const trimmed = expr.trim();
  if (trimmed.length === 0) return null;
  for (const bad of UNSUPPORTED) {
    if (trimmed.includes(bad)) return null;
  }

  let js = trimmed;

  // Method macros: this.foo.size() -> v.foo.length
  for (const [cel, repl] of Object.entries(METHOD_MAP)) {
    js = js.split("." + cel).join("." + repl);
  }

  // `this` -> `v` (word-boundary).
  js = js.replace(/\bthis\b/g, "v");

  // CEL equality operators -> strict JS equality. Order matters (do == / != but
  // not <= >=).
  js = js.replace(/(^|[^<>=!])==(?!=)/g, "$1===");
  js = js.replace(/(^|[^<>=!])!=(?!=)/g, "$1!==");

  // Validate the residual only contains a safe character/token set. Anything
  // suspicious (a stray identifier-call we did not map, brackets, etc.) bails.
  if (/[`;{}]/.test(js)) return null;
  // Disallow any remaining `.identifier(` call we did not translate.
  if (/\.[a-zA-Z_]\w*\(/.test(js)) return null;

  return js;
}
