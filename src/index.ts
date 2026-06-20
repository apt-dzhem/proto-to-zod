import { createEcmaScriptPlugin } from "@bufbuild/protoplugin";
import { generateTs } from "./generate.js";
import { parseZodOptions } from "./options.js";

/**
 * The protoc-gen-zod plugin: generates Zod v4 schemas from Protobuf, mapping
 * protovalidate (buf.validate) field rules to Zod validations.
 */
export const protocGenZod = createEcmaScriptPlugin({
  name: "protoc-gen-zod",
  version: "v0.1.0",
  parseOptions: parseZodOptions,
  generateTs,
});

export { parseZodOptions } from "./options.js";
export type { ZodPluginOptions } from "./options.js";
