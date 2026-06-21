// Map a DescField to a Zod expression: base type from the field's kind, then
// protovalidate rules, then presence (.optional()).

import { ScalarType, getOption } from "@bufbuild/protobuf";
import { FeatureSet_FieldPresence } from "@bufbuild/protobuf/wkt";
import type { DescField, DescMessage, DescEnum } from "@bufbuild/protobuf";
import { createImportSymbol } from "@bufbuild/protoplugin";
import type { GeneratedFile, ImportSymbol } from "@bufbuild/protoplugin";
import { ZodExpr } from "./zexpr.js";
import type { GenCtx } from "./context.js";
import { applyTypedRules } from "./rules.js";
import { field as fieldRulesExt } from "./gen/buf/validate/validate_pb.js";
import type { FieldRules } from "./gen/buf/validate/validate_pb.js";

/** Well-known type base mappings keyed by fully-qualified message name. */
function wktBase(ctx: GenCtx, typeName: string): ZodExpr | undefined {
  switch (typeName) {
    case "google.protobuf.Timestamp":
      return ctx.opts.timestamp === "date"
        ? ZodExpr.base(ctx.z, ".date()")
        : ZodExpr.base(ctx.z, ".iso.datetime()");
    case "google.protobuf.Duration":
      return ZodExpr.base(ctx.z, ".string()");
    case "google.protobuf.StringValue":
      return ZodExpr.base(ctx.z, ".string()");
    case "google.protobuf.BoolValue":
      return ZodExpr.base(ctx.z, ".boolean()");
    case "google.protobuf.Int32Value":
    case "google.protobuf.UInt32Value":
    case "google.protobuf.FloatValue":
    case "google.protobuf.DoubleValue":
      return ZodExpr.base(ctx.z, ".number()");
    case "google.protobuf.Int64Value":
    case "google.protobuf.UInt64Value":
      return ctx.opts.int64 === "bigint"
        ? ZodExpr.base(ctx.z, ".bigint()")
        : ZodExpr.base(ctx.z, ".string()");
    case "google.protobuf.BytesValue":
      return ZodExpr.base(ctx.z, ".instanceof(Uint8Array)");
    case "google.protobuf.Any":
      return ZodExpr.raw(ctx.z, '.looseObject({ "@type": ', ctx.z, ".string() })");
    case "google.protobuf.Struct":
    case "google.protobuf.Value":
    case "google.protobuf.ListValue":
    case "google.protobuf.Empty":
    case "google.protobuf.FieldMask":
      return ZodExpr.base(ctx.z, ".unknown()");
    default:
      return undefined;
  }
}

function scalarBase(ctx: GenCtx, scalar: ScalarType): ZodExpr {
  const z = ctx.z;
  switch (scalar) {
    case ScalarType.STRING:
      return ZodExpr.base(z, ".string()");
    case ScalarType.BOOL:
      return ZodExpr.base(z, ".boolean()");
    case ScalarType.FLOAT:
    case ScalarType.DOUBLE:
      return ZodExpr.base(z, ".number()");
    case ScalarType.INT32:
    case ScalarType.SINT32:
    case ScalarType.SFIXED32:
      return ZodExpr.base(z, ".number()").call("int");
    case ScalarType.UINT32:
    case ScalarType.FIXED32:
      return ZodExpr.base(z, ".number()").call("int").call("nonnegative");
    case ScalarType.INT64:
    case ScalarType.SINT64:
    case ScalarType.SFIXED64:
      return int64Base(ctx, false);
    case ScalarType.UINT64:
    case ScalarType.FIXED64:
      return int64Base(ctx, true);
    case ScalarType.BYTES:
      return ctx.opts.bytes === "uint8array"
        ? ZodExpr.base(z, ".instanceof(Uint8Array)")
        : ZodExpr.base(z, ".string()");
    default:
      return ZodExpr.base(z, ".unknown()");
  }
}

function int64Base(ctx: GenCtx, unsigned: boolean): ZodExpr {
  const z = ctx.z;
  switch (ctx.opts.int64) {
    case "bigint": {
      const e = ZodExpr.base(z, ".bigint()");
      return unsigned ? e.call("nonnegative") : e;
    }
    case "number":
      return ZodExpr.base(z, ".number()").call("int");
    case "string":
      return ZodExpr.base(z, ".string()").call("regex", unsigned ? "/^\\d+$/" : "/^-?\\d+$/");
  }
}

/**
 * Import the protobuf-es enum as a runtime VALUE (not type-only). `importShape`
 * always returns a type-only symbol, which is unusable for `z.enum(Role)`, so
 * we clone its name/path with typeOnly=false.
 */
export function enumValueSymbol(f: GeneratedFile, desc: DescEnum): ImportSymbol {
  const shape = f.importShape(desc);
  return createImportSymbol(shape.name, shape.from, false);
}

function enumBase(ctx: GenCtx, desc: DescEnum): ZodExpr {
  if (ctx.opts.enums === "stringliteral") {
    const names = desc.values.map((v) => JSON.stringify(v.name));
    return ZodExpr.base(ctx.z, `.enum([${names.join(", ")}])`);
  }
  // native: reference the protobuf-es enum object at runtime.
  const sym = enumValueSymbol(ctx.f, desc);
  return ZodExpr.raw(ctx.z, ".enum(", sym, ")");
}

/** Reference another message's generated schema const, lazily if not yet declared. */
function messageRef(ctx: GenCtx, desc: DescMessage): ZodExpr {
  const wkt = wktBase(ctx, desc.typeName);
  if (wkt) return wkt;

  const name = `${desc.name}Schema`;
  let ref: ZodExpr;
  if (ctx.declared.has(desc.typeName)) {
    ref = ZodExpr.raw(name);
  } else if (sameFile(ctx, desc)) {
    // Forward / recursive reference in the same file. Emit the bare schema name
    // and flag the field so it is rendered as a recursive getter (Zod 4 idiom),
    // which preserves type inference unlike z.lazy().
    ctx.lazyTracker.used = true;
    ref = ZodExpr.raw(name);
  } else {
    const sym = ctx.f.import(name, `./${desc.file.name}_zod.js`);
    ref = ZodExpr.raw(sym);
  }
  return ref;
}

function sameFile(ctx: GenCtx, desc: DescMessage): boolean {
  // The output file is named after the proto file; declared-set membership and
  // file identity both indicate "this file". We approximate via the import
  // path: if importShape would resolve to the same _pb, treat as same file.
  return ctx.currentFile === desc.file.name;
}

/** Build the element schema for a list value, applying nested item rules. */
function elementExpr(
  ctx: GenCtx,
  field: Extract<DescField, { fieldKind: "list" }>,
  nested: FieldRules | undefined,
): ZodExpr {
  let base: ZodExpr;
  if (field.listKind === "message") base = messageRef(ctx, field.message);
  else if (field.listKind === "enum") base = enumBase(ctx, field.enum);
  else base = scalarBase(ctx, field.scalar);
  if (nested) base = applyTypedRules(base, nested, ctx);
  return base;
}

/**
 * The public entry: produce the Zod expression for a single message field.
 * When `suppressOptional` is set the `.optional()` presence wrapper is omitted
 * (used for oneof members, whose value is always present within their case).
 */
export function fieldExpr(ctx: GenCtx, field: DescField, suppressOptional = false): ZodExpr {
  const rules: FieldRules | undefined = field.proto.options
    ? getOption(field, fieldRulesExt)
    : undefined;

  let expr: ZodExpr;

  switch (field.fieldKind) {
    case "scalar":
      expr = scalarBase(ctx, field.scalar);
      break;
    case "enum":
      expr = enumBase(ctx, field.enum);
      break;
    case "message":
      expr = messageRef(ctx, field.message);
      break;
    case "list": {
      const itemRules = rules?.type.case === "repeated" ? rules.type.value.items : undefined;
      const el = elementExpr(ctx, field, itemRules);
      expr = ZodExpr.raw(ctx.z, ".array(", ...el.toParts(), ")");
      break;
    }
    case "map": {
      const mapRules = rules?.type.case === "map" ? rules.type.value : undefined;
      const keyExpr = mapKeyExpr(ctx, field, mapRules?.keys);
      const valExpr = mapValueExpr(ctx, field, mapRules?.values);
      expr = ZodExpr.raw(ctx.z, ".record(", ...keyExpr.toParts(), ", ", ...valExpr.toParts(), ")");
      break;
    }
  }

  // Container-level / scalar rules.
  if (rules && field.fieldKind !== "message") {
    expr = applyTypedRules(expr, rules, ctx);
  }

  // Presence -> optional. Lists and maps are always present. `suppressOptional`
  // is used by oneof members and by the all-optional .partial() optimization.
  if (!suppressOptional && fieldIsOptional(field)) {
    expr =
      ctx.opts.presence === "exact"
        ? ZodExpr.raw(ctx.z, ".exactOptional(", ...expr.toParts(), ")")
        : expr.optional();
  }

  return expr;
}

/**
 * Whether a field is optional (tracks presence and is not required). Lists and
 * maps are always present. Shared by field emission and the all-optional
 * `.partial()` detection.
 */
export function fieldIsOptional(field: DescField): boolean {
  if (field.fieldKind === "list" || field.fieldKind === "map") return false;
  const rules: FieldRules | undefined = field.proto.options
    ? getOption(field, fieldRulesExt)
    : undefined;
  const tracksPresence =
    field.presence === FeatureSet_FieldPresence.EXPLICIT ||
    field.presence === FeatureSet_FieldPresence.LEGACY_REQUIRED;
  const required =
    rules?.required === true || field.presence === FeatureSet_FieldPresence.LEGACY_REQUIRED;
  return tracksPresence && !required;
}

function mapKeyExpr(ctx: GenCtx, field: Extract<DescField, { fieldKind: "map" }>, nested: FieldRules | undefined): ZodExpr {
  let base = scalarBase(ctx, field.mapKey);
  if (nested) base = applyTypedRules(base, nested, ctx);
  return base;
}

function mapValueExpr(ctx: GenCtx, field: Extract<DescField, { fieldKind: "map" }>, nested: FieldRules | undefined): ZodExpr {
  let base: ZodExpr;
  if (field.mapKind === "message") base = messageRef(ctx, field.message);
  else if (field.mapKind === "enum") base = enumBase(ctx, field.enum);
  else base = scalarBase(ctx, field.scalar);
  if (nested) base = applyTypedRules(base, nested, ctx);
  return base;
}
