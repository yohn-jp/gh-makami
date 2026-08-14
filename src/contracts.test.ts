import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAPABILITY_SCHEMA,
  DEFAULT_LIMITS,
  MakamiError,
  createPRGeneration,
  createReviewClaim,
  digestJson,
  getPRGenerationKey,
  getSignalIdentity,
  serializeBounded,
  sha256Digest,
  sortSignals,
  stableStringify,
  truncateUtf8,
  withLimits,
  type CheckSignal,
  type SourceRef,
} from "./contracts.js";

const source: SourceRef = {
  provider: "github",
  resourceType: "check-run",
  resourceId: "check-1",
};

function generation(observedAt = "2026-08-14T00:00:00.000Z") {
  return createPRGeneration({
    repository: "octo/example",
    prNumber: 7,
    headSha: "a".repeat(40),
    baseRef: "main",
    observedAt,
  });
}

test("publishes a versioned capability schema", () => {
  assert.equal(CAPABILITY_SCHEMA.contract.identifier, "gh-makami/contracts/v0");
  assert.ok(CAPABILITY_SCHEMA.capabilities.some(({ id }) => id === "pr-generation"));
  assert.ok(CAPABILITY_SCHEMA.capabilities.some(({ id }) => id === "deterministic-json"));
});

test("PR generation identity excludes observation volatility", () => {
  const first = generation();
  const second = { ...generation("2026-08-15T00:00:00.000Z"), baseRef: "release" };

  assert.equal(getPRGenerationKey(first), getPRGenerationKey(second));
  assert.match(getPRGenerationKey(first), /octo\/example#7@a{40}/);
  assert.notEqual(getPRGenerationKey(first), getPRGenerationKey({ ...first, headSha: "b".repeat(40) }));
});

test("review claims preserve opaque text and source provenance", () => {
  const claim = createReviewClaim({
    claimId: "review-comment-1",
    generation: getGenerationIdentity(),
    source,
    provenance: {
      kind: "observed",
      source,
      observedAt: "2026-08-14T00:00:00.000Z",
    },
    body: "Please consider this edge case.",
    lifecycle: { currentness: "current", resolution: "unresolved" },
    createdAt: "2026-08-14T00:00:00.000Z",
  });

  assert.equal(claim.bodyDigest, sha256Digest(claim.body));
  assert.equal(claim.provenance.kind, "observed");
  assert.equal("severity" in claim, false);
  assert.equal("remediation" in claim, false);
});

test("stable JSON sorts object keys and preserves array order", () => {
  const value = { z: [2, 1], nested: { b: true, a: "value" }, a: 1 } as const;
  assert.equal(stableStringify(value), '{"a":1,"nested":{"a":"value","b":true},"z":[2,1]}');
  assert.equal(digestJson(value), "339c19e9fed4a07b7b81e3cc1b9ded799c24bb286e90cb6ed58516272051e55b");
});

test("stable JSON rejects non-finite and cyclic values", () => {
  assert.throws(() => stableStringify({ value: Number.NaN }), MakamiError);
  assert.throws(() => stableStringify(new Date()), MakamiError);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => stableStringify(cyclic as never), MakamiError);
});

test("bounded output and errors use finite stable limits", () => {
  assert.equal(DEFAULT_LIMITS.maxOutputBytes, 65_536);
  assert.deepEqual(withLimits({ maxSignals: 2 }).maxSignals, 2);
  assert.throws(
    () => serializeBounded({ value: "ok" }, { ...DEFAULT_LIMITS, maxOutputBytes: Number.POSITIVE_INFINITY }),
    RangeError,
  );
  assert.equal(truncateUtf8("あいうえお", 9), "あい…");
  assert.throws(() => serializeBounded({ value: "x".repeat(100) }, withLimits({ maxOutputBytes: 10 })), MakamiError);

  const error = new MakamiError("limit-exceeded", "x".repeat(100));
  assert.ok(Buffer.byteLength(error.toBoundedError(withLimits({ maxErrorMessageBytes: 10 })).message) <= 10);
});

test("signal sorting is deterministic and keeps signal families discriminated", () => {
  const base = {
    generation: getGenerationIdentity(),
    source,
    provenance: { kind: "observed" as const, source, observedAt: "2026-08-14T00:00:00.000Z" },
    lifecycle: { currentness: "current" as const, resolution: "not-applicable" as const },
  };
  const signals: CheckSignal[] = [
    {
      ...base,
      id: "b",
      kind: "check",
      check: { name: "lint", status: "completed", conclusion: "success" },
    },
    {
      ...base,
      id: "a",
      kind: "check",
      check: { name: "typecheck", status: "completed", conclusion: "success" },
    },
  ];

  assert.deepEqual(
    sortSignals(signals).map(({ id }) => id),
    ["a", "b"],
  );
  assert.equal(getSignalIdentity(signals[0]), "octo/example#7@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:check:b");
});

function getGenerationIdentity() {
  const value = generation();
  return { repository: value.repository, prNumber: value.prNumber, headSha: value.headSha };
}
