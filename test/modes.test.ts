// Tests for presence=exact (z.exactOptional) and partial=true (.partial()),
// both generated for the all-optional `Profile` message.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ProfileSchema as Default } from "../gen/example/v1/coverage_zod.js";
import { ProfileSchema as Partial } from "../gen-partial/example/v1/coverage_zod.js";
import { ProfileSchema as Exact } from "../gen-exact/example/v1/coverage_zod.js";

function read(dir: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../${dir}/example/v1/coverage_zod.ts`, import.meta.url)),
    "utf8",
  );
}

describe("partial=true (.partial() for all-optional messages)", () => {
  it("emits .partial() and drops per-field .optional()", () => {
    const src = read("gen-partial");
    const block = src.slice(src.indexOf("export const ProfileSchema"));
    const decl = block.slice(0, block.indexOf("ProfileZod"));
    expect(decl).toContain("}).partial();");
    expect(decl).not.toContain(".optional()");
  });
  it("accepts an empty object and partial data", () => {
    expect(Partial.safeParse({}).success).toBe(true);
    expect(Partial.safeParse({ displayName: "x" }).success).toBe(true);
  });
  it("still enforces rules when a field is present", () => {
    expect(Partial.safeParse({ displayName: "" }).success).toBe(false);
    expect(Partial.safeParse({ birthYear: 1800 }).success).toBe(false);
  });
  it("accepts an explicit undefined (same as .optional())", () => {
    expect(Partial.safeParse({ bio: undefined }).success).toBe(true);
  });
});

describe("presence=exact (z.exactOptional)", () => {
  it("emits z.exactOptional(...) per field", () => {
    expect(read("gen-exact")).toContain("displayName: z.exactOptional(z.string().min(1))");
  });
  it("accepts an absent key", () => {
    expect(Exact.safeParse({}).success).toBe(true);
    expect(Exact.safeParse({ displayName: "x" }).success).toBe(true);
  });
  it("enforces rules when present", () => {
    expect(Exact.safeParse({ displayName: "" }).success).toBe(false);
  });
  it("rejects an explicit undefined (the exact-optional distinction)", () => {
    expect(Exact.safeParse({ bio: undefined }).success).toBe(false);
  });
});

describe("default presence=optional (baseline contrast)", () => {
  it("uses per-field .optional() and accepts explicit undefined", () => {
    expect(read("gen")).toContain("displayName: z.string().min(1).optional()");
    expect(Default.safeParse({ bio: undefined }).success).toBe(true);
  });
});
