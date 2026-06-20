// Oracle test: the strongest correctness guarantee. For each case we build a
// protobuf-es message, validate it with the REAL protovalidate runtime, and
// validate the same data with our generated Zod schema. The accept/reject
// verdicts must agree.

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import type { DescMessage, MessageInitShape } from "@bufbuild/protobuf";
import type { ZodType } from "zod";

import {
  BatterySchema as BatteryDesc,
  ContactSchema as ContactDesc,
  TreeSchema as TreeDesc,
} from "../gen/example/v1/coverage_pb.js";
import {
  BatterySchema as BatteryZod,
  ContactSchema as ContactZod,
  TreeSchema as TreeZod,
} from "../gen/example/v1/coverage_zod.js";

const validator = createValidator();

// Brand-free init shape: the protobuf-es message brand fields ($typeName,
// $unknown) confuse TS overload resolution when spreading partials, so we omit
// them from the test inputs.
type Init<Desc extends DescMessage> = Omit<MessageInitShape<Desc>, "$typeName" | "$unknown">;

function protovalidateValid<Desc extends DescMessage>(
  desc: Desc,
  init: Init<Desc>,
): boolean {
  const msg = create(desc, init as MessageInitShape<Desc>);
  const r = validator.validate(desc, msg);
  if (r.kind === "error") throw r.error;
  return r.kind === "valid";
}

function zodValid<Desc extends DescMessage>(
  desc: Desc,
  zod: ZodType,
  init: Init<Desc>,
): boolean {
  const msg = create(desc, init as MessageInitShape<Desc>);
  return zod.safeParse(msg).success;
}

/** Assert both validators agree (and, when given, match the expectation). */
function agree<Desc extends DescMessage>(
  desc: Desc,
  zod: ZodType,
  init: Init<Desc>,
  expected?: boolean,
): void {
  const proto = protovalidateValid(desc, init);
  const zres = zodValid(desc, zod, init);
  expect(zres, `zod (${zres}) vs protovalidate (${proto})`).toBe(proto);
  if (expected !== undefined) {
    expect(proto, "protovalidate verdict vs expected").toBe(expected);
  }
}

const validBattery: Init<typeof BatteryDesc> = {
  i32: 50,
  i64: 5n,
  u32: 5,
  u64: 0n,
  s32: 7,
  dbl: 1.5,
  flt: 0.5,
  ranked: 100,
  email: "a@b.com",
  uuid: "550e8400-e29b-41d4-a716-446655440000",
  url: "https://example.com",
  v4: "1.2.3.4",
  v6: "::1",
  sized: "abc",
  exact: "abcd",
  pat: "ABC",
  pref: "go-x",
  suf: "x-end",
  has: "amidb",
  agreed: true,
  blob: new Uint8Array([1, 2]),
  color: 1,
  tags: ["a", "b"],
  counts: { x: 1 },
  nickname: "ab",
};

describe("Battery — baseline", () => {
  it("accepts a fully valid message in both", () => {
    agree(BatteryDesc, BatteryZod, validBattery, true);
  });
});

describe("Battery — per-field mutations all reject in both", () => {
  const mutations: Record<string, Partial<Init<typeof BatteryDesc>>> = {
    "i32 below min": { i32: 0 },
    "i32 above max": { i32: 101 },
    "i64 not gt 0": { i64: 0n },
    "u32 above max": { u32: 11 },
    "s32 out of range": { s32: 4 },
    "dbl not gt 0": { dbl: 0 },
    "flt above max": { flt: 2 },
    "ranked not lt": { ranked: 1000 },
    "email invalid": { email: "nope" },
    "uuid invalid": { uuid: "not-a-uuid" },
    "url invalid": { url: "definitely not a url" },
    "ipv4 invalid": { v4: "999.1.1.1" },
    "ipv6 invalid": { v6: "nope" },
    "sized too short": { sized: "a" },
    "sized too long": { sized: "abcdef" },
    "exact wrong len": { exact: "ab" },
    "pattern mismatch": { pat: "abc" },
    "prefix missing": { pref: "no-x" },
    "suffix missing": { suf: "x-nope" },
    "contains missing": { has: "nope" },
    "bool const false": { agreed: false },
    "bytes too few": { blob: new Uint8Array([]) },
    "bytes too many": { blob: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]) },
    "tags empty": { tags: [] },
    "tags too many": { tags: ["a", "b", "c", "d"] },
    "tags not unique": { tags: ["a", "a"] },
    "tags item empty": { tags: ["a", ""] },
    "counts empty": { counts: {} },
    "nickname too short": { nickname: "a" },
  };

  for (const [name, patch] of Object.entries(mutations)) {
    it(name, () => {
      agree(BatteryDesc, BatteryZod, { ...validBattery, ...patch }, false);
    });
  }
});

describe("Contact — required oneof", () => {
  it("accepts a set channel", () => {
    agree(ContactDesc, ContactZod, { channel: { case: "email", value: "a@b.com" }, label: "home" }, true);
  });
  it("accepts the phone branch", () => {
    agree(ContactDesc, ContactZod, { channel: { case: "phone", value: "1234567" } }, true);
  });
  it("rejects an unset required oneof", () => {
    agree(ContactDesc, ContactZod, { label: "x" }, false);
  });
  it("rejects an invalid branch value", () => {
    agree(ContactDesc, ContactZod, { channel: { case: "email", value: "nope" } }, false);
  });
});

describe("Tree — recursive", () => {
  it("accepts a valid nested tree", () => {
    agree(TreeDesc, TreeZod, { value: "root", children: [{ value: "child", children: [] }] }, true);
  });
  it("rejects an empty value deep in the tree", () => {
    agree(TreeDesc, TreeZod, { value: "root", children: [{ value: "", children: [] }] }, false);
  });
});
