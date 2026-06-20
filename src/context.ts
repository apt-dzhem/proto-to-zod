import type { ImportSymbol, GeneratedFile } from "@bufbuild/protoplugin";
import type { ZodPluginOptions } from "./options.js";

/** Shared state threaded through the generator for one output file. */
export interface GenCtx {
  readonly f: GeneratedFile;
  readonly z: ImportSymbol;
  readonly opts: ZodPluginOptions;
  /** typeNames of messages already declared in this file (for lazy refs). */
  readonly declared: Set<string>;
  /** proto name of the file currently being generated (e.g. "example/v1/user"). */
  readonly currentFile: string;
  /**
   * Set to true by messageRef when it emits a forward/recursive reference (a
   * bare schema name that is not yet declared). The caller resets it before
   * building a field and, if set afterwards, emits the field as a recursive
   * getter (Zod 4 idiom) so type inference is preserved.
   */
  readonly lazyTracker: { used: boolean };
}
