// Oracle test for both int64 representations. For each value we check three
// verdicts agree: the real protovalidate runtime, the default (bigint-mode)
// Zod schema on the message, and the JSON-mode (int64=string) Zod schema on the
// proto3 JSON form. `Bounds` has only 64-bit int fields so there is no bytes /
// enum JSON-shape noise.

import { describe, it, expect } from "vitest";
import { create, toJson } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";

import { BoundsSchema as BoundsDesc } from "../gen/example/v1/coverage_pb.js";
import { BoundsSchema as BoundsBigint } from "../gen/example/v1/coverage_zod.js";
import { BoundsSchema as BoundsJson } from "../gen-json/example/v1/coverage_zod.js";

const validator = createValidator();

function verdicts(lo: bigint, hi: bigint): { proto: boolean; bigint: boolean; json: boolean } {
  const msg = create(BoundsDesc, { lo, hi });
  const r = validator.validate(BoundsDesc, msg);
  if (r.kind === "error") throw r.error;
  const json = toJson(BoundsDesc, msg, { alwaysEmitImplicit: true });
  return {
    proto: r.kind === "valid",
    bigint: BoundsBigint.safeParse(msg).success,
    json: BoundsJson.safeParse(json).success,
  };
}

describe("int64 — bigint and string(JSON) modes agree with protovalidate", () => {
  const cases: [string, bigint, bigint, boolean][] = [
    ["valid mid-range", 5n, 100n, true],
    ["valid at bounds", 0n, 1000n, true],
    ["lo below 0", -1n, 100n, false],
    ["hi above 1000", 5n, 1001n, false],
    ["large valid lo", 9007199254740993n, 100n, true],
  ];
  for (const [name, lo, hi, expected] of cases) {
    it(name, () => {
      const v = verdicts(lo, hi);
      expect(v.proto, "protovalidate vs expected").toBe(expected);
      expect(v.bigint, "bigint-mode zod vs protovalidate").toBe(v.proto);
      expect(v.json, "json-mode zod vs protovalidate").toBe(v.proto);
    });
  }
});

describe("JSON-mode int64 is emitted as a validated string schema", () => {
  it("accepts decimal-string ints", () => {
    expect(BoundsJson.safeParse({ lo: "5", hi: "100" }).success).toBe(true);
  });
  it("rejects non-numeric strings", () => {
    expect(BoundsJson.safeParse({ lo: "abc", hi: "100" }).success).toBe(false);
  });
});
