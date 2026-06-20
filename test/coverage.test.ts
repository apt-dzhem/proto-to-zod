// Coverage test: asserts the generator emits the expected Zod 4 constructs for
// the example protos. This documents the breadth of Zod features the tool
// exercises and guards against regressions in emitted source.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function gen(file: string): string {
  return readFileSync(fileURLToPath(new URL(`../gen/example/v1/${file}`, import.meta.url)), "utf8");
}

const coverage = gen("coverage_zod.ts");
const user = gen("user_zod.ts");
const all = coverage + "\n" + user;

describe("emitted Zod feature coverage", () => {
  const features: Record<string, string> = {
    // Zod 4 top-level string formats
    "z.email()": "z.email()",
    "z.uuid()": "z.uuid()",
    "z.url()": "z.url()",
    "z.ipv4()": "z.ipv4()",
    "z.ipv6()": "z.ipv6()",
    // primitives & containers
    "z.string()": "z.string()",
    "z.boolean()": "z.boolean()",
    "z.bigint()": "z.bigint()",
    "z.instanceof(Uint8Array)": "z.instanceof(Uint8Array)",
    "z.array(": "z.array(",
    "z.record(": "z.record(",
    "z.union(": "z.union(",
    "z.enum(": "z.enum(",
    "z.object(": "z.object(",
    "z.literal(": "z.literal(",
    // number checks
    ".int()": ".int()",
    ".nonnegative()": ".nonnegative()",
    ".finite()": ".finite()",
    ".gt(": ".gt(",
    ".gte(": ".gte(",
    ".lt(": ".lt(",
    ".lte(": ".lte(",
    // string checks
    ".min(": ".min(",
    ".max(": ".max(",
    ".length(": ".length(",
    ".regex(": ".regex(",
    ".startsWith(": ".startsWith(",
    ".endsWith(": ".endsWith(",
    ".includes(": ".includes(",
    // refinements & presence
    ".refine(": ".refine(",
    ".superRefine(": ".superRefine(",
    ".optional()": ".optional()",
    // inferred type exports
    "z.infer<": "z.infer<",
  };

  for (const [name, needle] of Object.entries(features)) {
    it(`emits ${name}`, () => {
      expect(all.includes(needle), `expected generated output to contain ${needle}`).toBe(true);
    });
  }
});

describe("structural expectations", () => {
  it("uses a recursive getter for the self-recursive Tree", () => {
    expect(coverage).toContain("get children() { return z.array(TreeSchema); }");
  });
  it("emits a required oneof as a union without an empty case", () => {
    const channel = coverage.slice(coverage.indexOf("channel: z.union(["));
    expect(channel).toContain('case: z.literal("email")');
    expect(channel).toContain('case: z.literal("phone")');
    // required oneof => no `{ case: z.undefined() }` branch before the closing.
    const union = channel.slice(0, channel.indexOf("]),"));
    expect(union).not.toContain("z.undefined()");
  });
  it("maps native enums to z.enum(EnumValue)", () => {
    expect(coverage).toContain("z.enum(Color)");
  });
  it("exports an inferred type per message", () => {
    expect(coverage).toContain("export type BatteryZod = z.infer<typeof BatterySchema>;");
  });
});
