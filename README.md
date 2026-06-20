# protoc-gen-zod

Generate [Zod 4](https://zod.dev) validation schemas directly from Protobuf — including the field validation rules you declare in `.proto` with [protovalidate](https://github.com/bufbuild/protovalidate) (`buf.validate`).

Built as a native [Buf](https://buf.build) plugin on `@bufbuild/protoplugin` + `@bufbuild/protobuf`. The generated schemas' inferred types line up with the [protobuf-es](https://github.com/bufbuild/protobuf-es) message types, so you declare a field's rules **once**, in the proto, and validate them at runtime in TypeScript.

> Design rationale and research notes: see [`../proto-to-zod-docs/spec.md`](../proto-to-zod-docs/spec.md).

## Example

`user.proto`:

```proto
message User {
  string id    = 1 [(buf.validate.field).string.uuid = true];
  string email = 2 [(buf.validate.field).string.email = true, (buf.validate.field).required = true];
  int32  age   = 4 [(buf.validate.field).int32 = { gte: 0, lte: 130 }];
  repeated string tags = 6 [(buf.validate.field).repeated = { min_items: 1, unique: true }];
}
```

generates `user_zod.ts`:

```ts
import { z } from "zod";

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  age: z.number().int().gte(0).lte(130),
  tags: z.array(z.string()).min(1).refine((a) => new Set(a).size === a.length, "items must be unique"),
});
export type UserZod = z.infer<typeof UserSchema>;
```

## Usage

```bash
npm install --save-dev protoc-gen-zod
```

`buf.gen.yaml`:

```yaml
version: v2
plugins:
  # protobuf-es message types
  - local: protoc-gen-es
    out: gen
    opt: [target=ts, import_extension=js]
  # Zod schemas (this plugin)
  - local: protoc-gen-zod
    out: gen
    opt: [target=ts, import_extension=js]
```

```bash
buf generate
```

The `*_zod.ts` files are emitted next to protobuf-es' `*_pb.ts`.

## Options

| Option | Values | Default | Meaning |
|---|---|---|---|
| `int64` | `bigint` \| `string` \| `number` | `bigint` | Representation of 64-bit integer fields. `string` matches proto3 JSON. |
| `bytes` | `uint8array` \| `base64` | `uint8array` | Representation of `bytes` fields. |
| `timestamp` | `date` \| `string` | `date` | `google.protobuf.Timestamp` mapping. |
| `enums` | `native` \| `stringliteral` | `native` | `z.enum(NativeEnum)` vs. `z.enum([...names])`. |
| `cel` | `comment` \| `skip` | `comment` | Fallback for CEL that can't be statically translated. |
| `zod_import` | any specifier | `zod` | Import source for `z` (e.g. `zod/mini`). |

## What it maps

- **Scalars** → `z.string()`, `z.number().int()`, `z.bigint()`, `z.boolean()`, `z.instanceof(Uint8Array)`, with unsigned → `.nonnegative()`.
- **Collections** → `z.array()`, `z.record()`; **enums** → `z.enum()`; **oneofs** → `z.union([...])`; **recursive messages** → Zod 4 recursive getters (type-preserving).
- **protovalidate rules**:
  - string: `min_len`/`max_len`/`len`, `pattern`, `prefix`/`suffix`/`contains`, `in`/`not_in`, byte-length, and Zod 4 formats (`email`, `uuid`, `uri`→`url`, `ipv4`, `ipv6`, …).
  - numeric: `const`, `gt`/`gte`/`lt`/`lte`, `in`/`not_in`, `finite`.
  - bool `const`; bytes length; enum `defined_only`/`const`/`in`/`not_in`.
  - repeated `min_items`/`max_items`/`unique`/`items`; map `min_pairs`/`max_pairs`/`keys`/`values`.
  - `required` (drops `.optional()`); required `oneof`.
  - message-level and field-level **CEL** → `.superRefine()` / `.refine()` for the supported subset, else a `// TODO(cel)` marker.

See [`../proto-to-zod-docs/03-proto-validation-rules.md`](../proto-to-zod-docs/03-proto-validation-rules.md) for the full mapping table.

## Development

```bash
npm install
npm run vendor      # (re)generate vendored buf.validate bindings into src/gen — rarely needed
npm run generate    # generate example schemas into gen/
npm test            # generate + run the suite (oracle, coverage, type tests)
npm run build       # compile the plugin to dist/
```

### Tests

- **`test/oracle.test.ts`** — the key guarantee: builds protobuf-es messages, validates them with the **real protovalidate runtime**, validates the same data with the generated Zod, and asserts the verdicts agree (baseline + per-field mutations across every rule kind, plus oneof and recursion).
- **`test/oracle-json.test.ts`** — same cross-check for `int64=string` (JSON-shape) mode.
- **`test/coverage.test.ts`** — asserts the breadth of emitted Zod 4 constructs.
- **`test/types.test-d.ts`** — type-level checks that `z.infer` matches the proto field types.

## Status & limitations

- Custom CEL beyond the supported subset is emitted as a `// TODO(cel)` marker (configurable). A runtime-CEL delegation mode (`@bufbuild/protovalidate`) is the planned next step — see the spec.
- `bytes=base64` length rules check string length, not decoded byte length.
- Well-known types (`Timestamp`, `Duration`, `Any`, `Struct`) have pragmatic default mappings; see `src/field.ts`.

Targets **Zod 4.x** and **`@bufbuild/*` 2.x**.
