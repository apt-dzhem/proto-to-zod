// Emit a Zod schema const for a single message, plus enum schemas.

import { getOption } from "@bufbuild/protobuf";
import type { DescMessage, DescEnum, DescOneof } from "@bufbuild/protobuf";
import type { Printable } from "@bufbuild/protoplugin";
import type { GenCtx } from "./context.js";
import { fieldExpr, enumValueSymbol } from "./field.js";
import { ZodExpr } from "./zexpr.js";
import { transpileCel } from "./cel.js";
import {
  message as messageRulesExt,
  oneof as oneofRulesExt,
} from "./gen/buf/validate/validate_pb.js";

export function generateEnum(ctx: GenCtx, desc: DescEnum): void {
  const { f, z } = ctx;
  f.print(f.jsDoc(desc));
  if (ctx.opts.enums === "stringliteral") {
    const names = desc.values.map((v) => JSON.stringify(v.name));
    f.print(f.export("const", `${desc.name}Schema`), " = ", z, `.enum([${names.join(", ")}]);`);
  } else {
    const sym = enumValueSymbol(f, desc);
    f.print(f.export("const", `${desc.name}Schema`), " = ", z, ".enum(", sym, ");");
  }
  f.print(f.export("type", `${desc.name}Zod`), " = ", z, `.infer<typeof ${desc.name}Schema>;`);
  f.print();
}

export function generateMessage(ctx: GenCtx, desc: DescMessage): void {
  const { f, z } = ctx;

  // Nested enums first so references resolve.
  for (const e of desc.nestedEnums) generateEnum(ctx, e);
  for (const m of desc.nestedMessages) generateMessage(ctx, m);

  f.print(f.jsDoc(desc));

  // Message-level CEL rules -> .superRefine() bodies (or TODO comments).
  const messageRules = desc.proto.options ? getOption(desc, messageRulesExt) : undefined;
  const superRefines: { js: string; message: string }[] = [];
  for (const rule of messageRules?.cel ?? []) {
    const js = transpileCel(rule.expression);
    const msg = rule.message || rule.id || rule.expression;
    if (js) {
      superRefines.push({ js, message: msg });
    } else if (ctx.opts.cel === "comment") {
      f.print(`// TODO(cel): unsupported expression: ${rule.expression}`);
    }
  }

  f.print(f.export("const", `${desc.name}Schema`), " = ", z, ".object({");
  for (const member of desc.members) {
    if (member.kind === "oneof") {
      emitOneof(ctx, member);
    } else {
      ctx.lazyTracker.used = false;
      const expr = fieldExpr(ctx, member);
      if (ctx.lazyTracker.used) {
        // Recursive/forward reference -> getter so it resolves lazily while
        // keeping full type inference.
        f.print("  get ", member.localName, "() { return ", ...expr.toParts(), "; },");
      } else {
        f.print("  ", member.localName, ": ", ...expr.toParts(), ",");
      }
    }
  }
  // Close object, then chain refinements.
  if (superRefines.length === 0) {
    f.print("});");
  } else {
    f.print("})");
    superRefines.forEach((sr, i) => {
      const last = i === superRefines.length - 1;
      f.print("  .superRefine((v, ctx) => {");
      f.print(`    if (!(${sr.js})) {`);
      f.print(`      ctx.addIssue({ code: "custom", message: ${JSON.stringify(sr.message)} });`);
      f.print("    }");
      f.print(`  })${last ? ";" : ""}`);
    });
  }

  f.print(f.export("type", `${desc.name}Zod`), " = ", z, `.infer<typeof ${desc.name}Schema>;`);
  f.print();

  ctx.declared.add(desc.typeName);
}

function emitOneof(ctx: GenCtx, oneof: DescOneof): void {
  const { f, z } = ctx;
  const required =
    oneof.proto.options ? getOption(oneof, oneofRulesExt).required === true : false;

  f.print("  ", oneof.localName, ": ", z, ".union([");
  for (const field of oneof.fields) {
    ctx.lazyTracker.used = false;
    let valueExpr = fieldExpr(ctx, field, /* suppressOptional */ true);
    // Getters are not available inside a union member object literal, so fall
    // back to z.lazy() for the rare recursive-oneof case.
    if (ctx.lazyTracker.used) valueExpr = valueExpr.lazy(z);
    const parts: Printable[] = [
      "    ",
      z,
      `.object({ case: `,
      z,
      `.literal(${JSON.stringify(field.localName)}), value: `,
      ...valueExpr.toParts(),
      " }),",
    ];
    f.print(...parts);
  }
  if (!required) {
    f.print("    ", z, ".object({ case: ", z, ".undefined() }),");
  }
  f.print("  ]),");
}

/** Build a bare reference expression to a schema const (used by tests/tools). */
export function schemaRef(name: string): ZodExpr {
  return ZodExpr.raw(name);
}
