import type { Schema } from "@bufbuild/protoplugin";
import type { GenCtx } from "./context.js";
import type { ZodPluginOptions } from "./options.js";
import { generateEnum, generateMessage } from "./message.js";

/**
 * Entry point invoked by protoplugin. Emits one `<proto>_zod.ts` per input
 * file, containing Zod schemas for every enum and message.
 */
export function generateTs(schema: Schema<ZodPluginOptions>): void {
  for (const file of schema.files) {
    const f = schema.generateFile(`${file.name}_zod.ts`);
    f.preamble(file);

    const z = f.import("z", schema.options.zodImport);
    const ctx: GenCtx = {
      f,
      z,
      opts: schema.options,
      declared: new Set<string>(),
      currentFile: file.name,
      lazyTracker: { used: false },
    };

    for (const e of file.enums) generateEnum(ctx, e);
    for (const m of file.messages) generateMessage(ctx, m);
  }
}
