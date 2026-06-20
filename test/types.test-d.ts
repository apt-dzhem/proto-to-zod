// Type-level test: the inferred types of generated schemas line up with the
// field types of the protobuf-es messages. We compare against the brand-free
// data shape (protobuf-es messages additionally carry a `$typeName` brand).

import { describe, it, expectTypeOf } from "vitest";
import type { z } from "zod";
import {
  BatterySchema as BatteryZod,
  ContactSchema as ContactZod,
  TreeSchema as TreeZod,
} from "../gen/example/v1/coverage_zod.js";

type Battery = z.infer<typeof BatteryZod>;
type Contact = z.infer<typeof ContactZod>;
type Tree = z.infer<typeof TreeZod>;

describe("inferred field types", () => {
  it("maps scalar types correctly", () => {
    expectTypeOf<Battery["i32"]>().toEqualTypeOf<number>();
    expectTypeOf<Battery["i64"]>().toEqualTypeOf<bigint>();
    expectTypeOf<Battery["u64"]>().toEqualTypeOf<bigint>();
    expectTypeOf<Battery["dbl"]>().toEqualTypeOf<number>();
    expectTypeOf<Battery["email"]>().toEqualTypeOf<string>();
    expectTypeOf<Battery["agreed"]>().toEqualTypeOf<true>();
    // Uint8Array carries a buffer type parameter; assert assignability.
    expectTypeOf<Battery["blob"]>().toMatchTypeOf<Uint8Array>();
  });

  it("maps collections correctly", () => {
    expectTypeOf<Battery["tags"]>().toEqualTypeOf<string[]>();
    expectTypeOf<Battery["counts"]>().toEqualTypeOf<Record<string, number>>();
  });

  it("makes proto3 optional fields optional", () => {
    expectTypeOf<Battery>().toHaveProperty("nickname");
    expectTypeOf<Battery["nickname"]>().toEqualTypeOf<string | undefined>();
  });

  it("models a oneof as a discriminated union", () => {
    expectTypeOf<Contact["channel"]>().toMatchTypeOf<
      { case: "email"; value: string } | { case: "phone"; value: string }
    >();
  });

  it("models recursive messages with preserved types (getter idiom)", () => {
    // toEqualTypeOf is strict: if recursion had degraded to `any`, these would
    // fail (any only equals any).
    expectTypeOf<Tree["value"]>().toEqualTypeOf<string>();
    expectTypeOf<Tree["children"]>().toEqualTypeOf<Tree[]>();
  });
});
