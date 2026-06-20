// Translation of protovalidate (buf.validate) field rules into Zod chains.
//
// Each applier receives the base ZodExpr for a field and appends `.min()`,
// `.regex()`, `.refine()` etc. Presence of a rule is determined with
// `isFieldSet` against the rule message's descriptor, because protobuf-es
// reports unset scalar rules as their zero value (0n / "") rather than
// undefined.

import { isFieldSet } from "@bufbuild/protobuf";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import type { ImportSymbol } from "@bufbuild/protoplugin";
import { ZodExpr, jsRegex, jsString } from "./zexpr.js";
import type { ZodPluginOptions } from "./options.js";
import {
  StringRulesSchema,
  BytesRulesSchema,
  BoolRulesSchema,
  EnumRulesSchema,
  RepeatedRulesSchema,
  MapRulesSchema,
  FloatRulesSchema,
  DoubleRulesSchema,
  Int32RulesSchema,
  Int64RulesSchema,
  UInt32RulesSchema,
  UInt64RulesSchema,
  SInt32RulesSchema,
  SInt64RulesSchema,
  Fixed32RulesSchema,
  Fixed64RulesSchema,
  SFixed32RulesSchema,
  SFixed64RulesSchema,
} from "./gen/buf/validate/validate_pb.js";
import type { FieldRules } from "./gen/buf/validate/validate_pb.js";

export interface RuleCtx {
  readonly z: ImportSymbol;
  readonly opts: ZodPluginOptions;
}

/** Set of `set`-ness checks for a typed rules message. */
function set<Desc extends DescMessage>(
  schema: Desc,
  msg: MessageShape<Desc>,
  fieldLocalName: string,
): boolean {
  const field = schema.field[fieldLocalName];
  if (!field) return false;
  return isFieldSet(msg, field);
}

function num(value: number | bigint, isBigint: boolean): string {
  return isBigint ? `${value.toString()}n` : `${value.toString()}`;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Apply the typed rule set carried by `FieldRules.type` to a base expression.
 * Returns a (possibly) new expression. Some rules (string well-known formats,
 * `const`) replace the base entirely.
 */
export function applyTypedRules(
  base: ZodExpr,
  rules: FieldRules,
  ctx: RuleCtx,
  itemExprFor?: (kind: "items" | "keys" | "values") => ZodExpr | undefined,
): ZodExpr {
  const t = rules.type;
  switch (t.case) {
    case "string":
      return applyStringRules(base, t.value, ctx);
    case "bool":
      return applyBoolRules(base, t.value, ctx);
    case "bytes":
      return applyBytesRules(base, t.value, ctx);
    case "enum":
      return applyEnumRules(base, t.value, ctx);
    case "float":
      return applyNumericRules(base, t.value, FloatRulesSchema, ctx, { repr: "number", float: true });
    case "double":
      return applyNumericRules(base, t.value, DoubleRulesSchema, ctx, { repr: "number", float: true });
    case "int32":
      return applyNumericRules(base, t.value, Int32RulesSchema, ctx, { repr: "number" });
    case "sint32":
      return applyNumericRules(base, t.value, SInt32RulesSchema, ctx, { repr: "number" });
    case "sfixed32":
      return applyNumericRules(base, t.value, SFixed32RulesSchema, ctx, { repr: "number" });
    case "uint32":
      return applyNumericRules(base, t.value, UInt32RulesSchema, ctx, { repr: "number" });
    case "fixed32":
      return applyNumericRules(base, t.value, Fixed32RulesSchema, ctx, { repr: "number" });
    case "int64":
      return applyNumericRules(base, t.value, Int64RulesSchema, ctx, { repr: ctx.opts.int64 });
    case "sint64":
      return applyNumericRules(base, t.value, SInt64RulesSchema, ctx, { repr: ctx.opts.int64 });
    case "sfixed64":
      return applyNumericRules(base, t.value, SFixed64RulesSchema, ctx, { repr: ctx.opts.int64 });
    case "uint64":
      return applyNumericRules(base, t.value, UInt64RulesSchema, ctx, { repr: ctx.opts.int64 });
    case "fixed64":
      return applyNumericRules(base, t.value, Fixed64RulesSchema, ctx, { repr: ctx.opts.int64 });
    case "repeated":
      return applyRepeatedRules(base, t.value, ctx, itemExprFor);
    case "map":
      return applyMapRules(base, t.value, ctx);
    default:
      return base;
  }
}

// ---------------------------------------------------------------------------
// String
// ---------------------------------------------------------------------------

type StringRules = Extract<FieldRules["type"], { case: "string" }>["value"];

const WELL_KNOWN_STRING: Record<string, string> = {
  email: "email",
  uuid: "uuid",
  ipv4: "ipv4",
  ipv6: "ipv6",
  uri: "url",
  ulid: "ulid",
  ipPrefix: "cidrv4", // best-effort
};

export function applyStringRules(base: ZodExpr, r: StringRules, ctx: RuleCtx): ZodExpr {
  // const replaces the base with a literal.
  if (set(StringRulesSchema, r, "const")) {
    return ZodExpr.base(ctx.z, `.literal(${jsString(r.const)})`);
  }

  // `in` becomes a string enum when no other format/length is needed; otherwise
  // a refine. We keep it simple and always emit z.enum for `in`.
  if (r.in.length > 0) {
    const enumArg = `[${r.in.map(jsString).join(", ")}]`;
    base = ZodExpr.base(ctx.z, `.enum(${enumArg})`);
  } else {
    // Well-known formats replace the z.string() base with a Zod 4 top-level
    // format (z.email(), z.uuid(), ...).
    const wk = r.wellKnown;
    if (wk.case && WELL_KNOWN_STRING[wk.case]) {
      base = ZodExpr.base(ctx.z, `.${WELL_KNOWN_STRING[wk.case]}()`);
    } else if (wk.case === "ip") {
      base = ZodExpr.raw(ctx.z, ".union([", ctx.z, ".ipv4(), ", ctx.z, ".ipv6()])");
    } else if (wk.case === "hostname") {
      base.call("regex", jsRegex("^(?=.{1,253}$)([a-zA-Z0-9](-?[a-zA-Z0-9])*)(\\.[a-zA-Z0-9](-?[a-zA-Z0-9])*)*$"));
    } else if (wk.case === "tuuid") {
      base.call("regex", jsRegex("^[0-9a-fA-F]{32}$"));
    }
  }

  if (set(StringRulesSchema, r, "len")) base.call("length", r.len.toString());
  if (set(StringRulesSchema, r, "minLen")) base.call("min", r.minLen.toString());
  if (set(StringRulesSchema, r, "maxLen")) base.call("max", r.maxLen.toString());
  if (set(StringRulesSchema, r, "pattern")) base.call("regex", jsRegex(r.pattern));
  if (set(StringRulesSchema, r, "prefix")) base.call("startsWith", jsString(r.prefix));
  if (set(StringRulesSchema, r, "suffix")) base.call("endsWith", jsString(r.suffix));
  if (set(StringRulesSchema, r, "contains")) base.call("includes", jsString(r.contains));
  if (set(StringRulesSchema, r, "notContains")) {
    base.call("refine", `(v) => !v.includes(${jsString(r.notContains)}), ${jsString(`must not contain ${r.notContains}`)}`);
  }
  if (r.notIn.length > 0) {
    const arr = `[${r.notIn.map(jsString).join(", ")}]`;
    base.call("refine", `(v) => !${arr}.includes(v), "must not be one of the forbidden values"`);
  }
  // byte-length rules need a TextEncoder; emit a refine.
  if (set(StringRulesSchema, r, "minBytes")) {
    base.call("refine", `(v) => new TextEncoder().encode(v).length >= ${r.minBytes.toString()}, "too few bytes"`);
  }
  if (set(StringRulesSchema, r, "maxBytes")) {
    base.call("refine", `(v) => new TextEncoder().encode(v).length <= ${r.maxBytes.toString()}, "too many bytes"`);
  }
  if (set(StringRulesSchema, r, "lenBytes")) {
    base.call("refine", `(v) => new TextEncoder().encode(v).length === ${r.lenBytes.toString()}, "wrong byte length"`);
  }
  return base;
}

// ---------------------------------------------------------------------------
// Numeric
// ---------------------------------------------------------------------------

interface NumericLike {
  const: number | bigint;
  lessThan: { case: "lt" | "lte"; value: number | bigint } | { case: undefined; value?: undefined };
  greaterThan: { case: "gt" | "gte"; value: number | bigint } | { case: undefined; value?: undefined };
  in: (number | bigint)[];
  notIn: (number | bigint)[];
  finite?: boolean;
}

export function applyNumericRules<Desc extends DescMessage>(
  base: ZodExpr,
  r: NumericLike & MessageShape<Desc>,
  schema: Desc,
  ctx: RuleCtx,
  kind: { repr: "number" | "bigint" | "string"; float?: boolean },
): ZodExpr {
  // In "string" repr (int64 carried as a decimal string) the base is z.string()
  // which has no numeric comparators, so comparisons go through BigInt() in a
  // refine. Otherwise we chain native .gt/.lt etc.
  if (kind.repr === "string") return applyNumericStringRules(base, r, schema);

  const isBig = kind.repr === "bigint";
  if (set(schema, r, "const")) {
    base.call("refine", `(v) => v === ${num(r.const, isBig)}, "must equal ${r.const.toString()}"`);
  }
  if (r.greaterThan.case === "gt") base.call("gt", num(r.greaterThan.value, isBig));
  if (r.greaterThan.case === "gte") base.call("gte", num(r.greaterThan.value, isBig));
  if (r.lessThan.case === "lt") base.call("lt", num(r.lessThan.value, isBig));
  if (r.lessThan.case === "lte") base.call("lte", num(r.lessThan.value, isBig));
  if (kind.float && r.finite === true) base.call("finite");
  if (r.in.length > 0) {
    const arr = `[${r.in.map((v) => num(v, isBig)).join(", ")}]`;
    base.call("refine", `(v) => ${arr}.includes(v), "must be one of the allowed values"`);
  }
  if (r.notIn.length > 0) {
    const arr = `[${r.notIn.map((v) => num(v, isBig)).join(", ")}]`;
    base.call("refine", `(v) => !${arr}.includes(v), "must not be one of the forbidden values"`);
  }
  return base;
}

/**
 * int64-as-string variant: compare with BigInt() inside refines. Zod does not
 * short-circuit on an earlier failing `.regex`, so each refine must guard
 * against a non-numeric string (BigInt() throws otherwise).
 */
function applyNumericStringRules<Desc extends DescMessage>(
  base: ZodExpr,
  r: NumericLike & MessageShape<Desc>,
  schema: Desc,
): ZodExpr {
  const lit = (v: number | bigint) => `${v.toString()}n`;
  // Wrap a BigInt comparison body in a try/catch so malformed input fails the
  // check instead of throwing.
  const guard = (body: string) => `(v) => { try { return ${body}; } catch { return false; } }`;

  if (set(schema, r, "const")) {
    base.call("refine", `${guard(`BigInt(v) === ${lit(r.const)}`)}, "must equal ${r.const.toString()}"`);
  }
  if (r.greaterThan.case === "gt") base.call("refine", `${guard(`BigInt(v) > ${lit(r.greaterThan.value)}`)}, "out of range"`);
  if (r.greaterThan.case === "gte") base.call("refine", `${guard(`BigInt(v) >= ${lit(r.greaterThan.value)}`)}, "out of range"`);
  if (r.lessThan.case === "lt") base.call("refine", `${guard(`BigInt(v) < ${lit(r.lessThan.value)}`)}, "out of range"`);
  if (r.lessThan.case === "lte") base.call("refine", `${guard(`BigInt(v) <= ${lit(r.lessThan.value)}`)}, "out of range"`);
  if (r.in.length > 0) {
    const arr = `[${r.in.map(lit).join(", ")}]`;
    base.call("refine", `${guard(`${arr}.includes(BigInt(v))`)}, "must be one of the allowed values"`);
  }
  if (r.notIn.length > 0) {
    const arr = `[${r.notIn.map(lit).join(", ")}]`;
    base.call("refine", `${guard(`!${arr}.includes(BigInt(v))`)}, "must not be one of the forbidden values"`);
  }
  return base;
}

// ---------------------------------------------------------------------------
// Bool / Bytes / Enum
// ---------------------------------------------------------------------------

type BoolRules = Extract<FieldRules["type"], { case: "bool" }>["value"];
export function applyBoolRules(base: ZodExpr, r: BoolRules, ctx: RuleCtx): ZodExpr {
  if (set(BoolRulesSchema, r, "const")) {
    return ZodExpr.base(ctx.z, `.literal(${r.const ? "true" : "false"})`);
  }
  return base;
}

type BytesRules = Extract<FieldRules["type"], { case: "bytes" }>["value"];
export function applyBytesRules(base: ZodExpr, r: BytesRules, ctx: RuleCtx): ZodExpr {
  if (set(BytesRulesSchema, r, "len")) base.call("refine", `(v) => v.length === ${r.len.toString()}, "wrong byte length"`);
  if (set(BytesRulesSchema, r, "minLen")) base.call("refine", `(v) => v.length >= ${r.minLen.toString()}, "too few bytes"`);
  if (set(BytesRulesSchema, r, "maxLen")) base.call("refine", `(v) => v.length <= ${r.maxLen.toString()}, "too many bytes"`);
  return base;
}

type EnumRules = Extract<FieldRules["type"], { case: "enum" }>["value"];
export function applyEnumRules(base: ZodExpr, r: EnumRules, ctx: RuleCtx): ZodExpr {
  // `defined_only` is already implied by z.enum(NativeEnum); `const`/in/not_in
  // become refines over the numeric value.
  if (set(EnumRulesSchema, r, "const")) {
    base.call("refine", `(v) => v === ${r.const.toString()}, "must equal ${r.const.toString()}"`);
  }
  if (r.in.length > 0) {
    base.call("refine", `(v) => [${r.in.join(", ")}].includes(v), "must be one of the allowed values"`);
  }
  if (r.notIn.length > 0) {
    base.call("refine", `(v) => ![${r.notIn.join(", ")}].includes(v), "must not be one of the forbidden values"`);
  }
  return base;
}

// ---------------------------------------------------------------------------
// Repeated / Map
// ---------------------------------------------------------------------------

type RepeatedRules = Extract<FieldRules["type"], { case: "repeated" }>["value"];
export function applyRepeatedRules(
  base: ZodExpr,
  r: RepeatedRules,
  ctx: RuleCtx,
  itemExprFor?: (kind: "items" | "keys" | "values") => ZodExpr | undefined,
): ZodExpr {
  if (set(RepeatedRulesSchema, r, "minItems")) base.call("min", r.minItems.toString());
  if (set(RepeatedRulesSchema, r, "maxItems")) base.call("max", r.maxItems.toString());
  if (r.unique === true) {
    base.call("refine", `(a) => new Set(a).size === a.length, "items must be unique"`);
  }
  return base;
}

type MapRules = Extract<FieldRules["type"], { case: "map" }>["value"];
export function applyMapRules(base: ZodExpr, r: MapRules, ctx: RuleCtx): ZodExpr {
  if (set(MapRulesSchema, r, "minPairs")) {
    base.call("refine", `(m) => Object.keys(m).length >= ${r.minPairs.toString()}, "too few entries"`);
  }
  if (set(MapRulesSchema, r, "maxPairs")) {
    base.call("refine", `(m) => Object.keys(m).length <= ${r.maxPairs.toString()}, "too many entries"`);
  }
  return base;
}
