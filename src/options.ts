// Parsing of the plugin's custom options (the `opt:` entries in buf.gen.yaml).

/** How 64-bit integer fields (int64, uint64, ...) are represented in TS/JSON. */
export type Int64Mode = "bigint" | "string" | "number";
/** How `bytes` fields are represented. */
export type BytesMode = "uint8array" | "base64";
/** How `google.protobuf.Timestamp` is represented. */
export type TimestampMode = "date" | "string";
/** How enums are represented (native protobuf-es enum vs. string literals). */
export type EnumMode = "native" | "stringliteral";
/** Strategy for CEL expressions that cannot be reduced to a static Zod chain. */
export type CelMode = "comment" | "skip";

export interface ZodPluginOptions {
  /** Default: "bigint". */
  int64: Int64Mode;
  /** Default: "uint8array". */
  bytes: BytesMode;
  /** Default: "date". */
  timestamp: TimestampMode;
  /** Default: "native". */
  enums: EnumMode;
  /** Default: "comment". */
  cel: CelMode;
  /** Emit `satisfies z.ZodType<Shape>` against the protobuf-es message shape. Default: true. */
  typeAlign: boolean;
  /** Import specifier for zod. Default: "zod". */
  zodImport: string;
}

export const defaultOptions: ZodPluginOptions = {
  int64: "bigint",
  bytes: "uint8array",
  timestamp: "date",
  enums: "native",
  cel: "comment",
  typeAlign: true,
  zodImport: "zod",
};

function parseEnum<T extends string>(
  key: string,
  value: string,
  allowed: readonly T[],
): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(
    `protoc-gen-zod: invalid value "${value}" for option "${key}". Allowed: ${allowed.join(", ")}`,
  );
}

function parseBool(key: string, value: string): boolean {
  if (value === "true" || value === "") return true;
  if (value === "false") return false;
  throw new Error(`protoc-gen-zod: option "${key}" expects true/false, got "${value}"`);
}

/**
 * protoplugin hands us each custom option as a `{ key, value }` pair (anything
 * it does not recognise as a standard option). We fold those into a typed config.
 */
export function parseZodOptions(
  raw: { key: string; value: string }[],
): ZodPluginOptions {
  const opts: ZodPluginOptions = { ...defaultOptions };
  for (const { key, value } of raw) {
    switch (key) {
      case "int64":
        opts.int64 = parseEnum(key, value, ["bigint", "string", "number"] as const);
        break;
      case "bytes":
        opts.bytes = parseEnum(key, value, ["uint8array", "base64"] as const);
        break;
      case "timestamp":
        opts.timestamp = parseEnum(key, value, ["date", "string"] as const);
        break;
      case "enums":
        opts.enums = parseEnum(key, value, ["native", "stringliteral"] as const);
        break;
      case "cel":
        opts.cel = parseEnum(key, value, ["comment", "skip"] as const);
        break;
      case "type_align":
        opts.typeAlign = parseBool(key, value);
        break;
      case "zod_import":
        opts.zodImport = value;
        break;
      default:
        throw new Error(`protoc-gen-zod: unknown option "${key}"`);
    }
  }
  return opts;
}
