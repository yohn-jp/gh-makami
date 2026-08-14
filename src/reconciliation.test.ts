import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRObservationError,
  getPRSnapshotDigest,
  normalizePRObservation,
  reconcilePRSnapshot,
  serializePRSnapshot,
  tryNormalizePRObservation,
  type PRSnapshot,
} from "./reconciliation.js";
import { MakamiError } from "./contracts.js";

const repository = "octo/example";
const firstHead = "a".repeat(40);
const secondHead = "b".repeat(40);

function observation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    repository,
    prNumber: 7,
    baseRef: "main",
    headSha: firstHead,
    state: "open",
    draft: false,
    merged: false,
    mergeable: true,
    conflicts: false,
    checkReferences: [{ id: "check-1", status: "completed", conclusion: "success" }],
    reviewReferences: [{ id: "review-1", state: "COMMENTED" }],
    observedAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  };
}

test("normalizes explicit repository/PR identity and generation state", () => {
  const snapshot = normalizePRObservation(observation());

  assert.equal(snapshot.repository, repository);
  assert.equal(snapshot.prNumber, 7);
  assert.equal(snapshot.baseRef, "main");
  assert.equal(snapshot.headSha, firstHead);
  assert.equal(snapshot.generation.headSha, firstHead);
  assert.equal(snapshot.lifecycle, "open");
  assert.equal(snapshot.checkReferences[0]?.lifecycle.currentness, "current");
  assert.equal(snapshot.reviewReferences[0]?.lifecycle.currentness, "current");
  assert.equal(snapshot.provenance.source.resourceId, "octo/example#7");
});

test("does not substitute caller cwd for missing explicit identity", () => {
  const result = tryNormalizePRObservation({
    ...observation(),
    repository: undefined,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.diagnostics.some(({ path, code }) => path === "repository" && code === "missing-field"));
});

test("pending and unknown mergeability remain explicit", () => {
  const pending = normalizePRObservation(observation({ mergeable: null, mergeableState: "unknown" }));
  const unknown = normalizePRObservation(
    observation({ mergeable: undefined, mergeableState: undefined, conflicts: undefined }),
  );

  assert.equal(pending.mergeability.state, "pending");
  assert.equal(pending.mergeability.remoteState, "unknown");
  assert.equal(unknown.mergeability.state, "unknown");
  assert.equal(unknown.conflicts.state, "unknown");
});

test("same remote state has deterministic canonical serialization apart from observedAt", () => {
  const first = normalizePRObservation(observation({ observedAt: "2026-08-14T00:00:00.000Z" }));
  const replay = normalizePRObservation(observation({ observedAt: "2026-08-15T00:00:00.000Z" }));

  assert.notEqual(first.generation.observedAt, replay.generation.observedAt);
  assert.equal(serializePRSnapshot(first), serializePRSnapshot(replay));
  assert.equal(getPRSnapshotDigest(first), getPRSnapshotDigest(replay));
  const delta = reconcilePRSnapshot(first, observation({ observedAt: "2026-08-15T00:00:00.000Z" }));
  assert.equal(delta.kind, "unchanged");
  assert.equal(delta.changed, false);
  assert.deepEqual(delta.changes, []);
});

test("new head rolls the generation and supersedes old generation references", () => {
  const first = normalizePRObservation(observation());
  const nextObservation = observation({
    headSha: secondHead,
    checkReferences: [{ id: "check-2", status: "queued" }],
    reviewReferences: [],
    observedAt: "2026-08-14T00:01:00.000Z",
  });
  const delta = reconcilePRSnapshot(first, nextObservation);

  assert.equal(delta.kind, "generation-rollover");
  assert.equal(delta.changed, true);
  assert.deepEqual(delta.previousGeneration, {
    repository,
    prNumber: 7,
    headSha: firstHead,
  });
  assert.equal(delta.snapshot.generation.headSha, secondHead);
  assert.equal(delta.snapshot.generationHistory.length, 2);
  assert.equal(delta.snapshot.checkReferences.find(({ id }) => id === "check-1")?.lifecycle.currentness, "superseded");
  assert.equal(delta.snapshot.checkReferences.find(({ id }) => id === "check-2")?.lifecycle.currentness, "current");
  assert.equal(
    delta.snapshot.reviewReferences.find(({ id }) => id === "review-1")?.lifecycle.currentness,
    "superseded",
  );
  assert.ok(delta.changes.some(({ kind }) => kind === "generation-rollover"));
});

test("same generation lifecycle changes are not reported as a new generation", () => {
  const first = normalizePRObservation(observation());
  const closed = observation({ state: "closed", merged: true, observedAt: "2026-08-14T00:02:00.000Z" });
  const delta = reconcilePRSnapshot(first, closed);

  assert.equal(delta.kind, "state-change");
  assert.equal(delta.generation.headSha, firstHead);
  assert.equal(delta.snapshot.lifecycle, "merged");
  assert.ok(delta.changes.some(({ kind }) => kind === "lifecycle-change"));
  assert.equal(
    delta.changes.some(({ kind }) => kind === "generation-rollover"),
    false,
  );
});

test("repository and PR identity cannot change through reconciliation", () => {
  const first = normalizePRObservation(observation());

  assert.throws(
    () => reconcilePRSnapshot(first, observation({ repository: "other/repository" })),
    (error: unknown) => {
      assert.ok(error instanceof PRObservationError);
      assert.deepEqual(
        error.diagnostics.map(({ path, code }) => `${path}:${code}`),
        ["repository:identity-mismatch"],
      );
      return true;
    },
  );
});

test("incomplete external snapshots fail with diagnostics instead of runtime errors", () => {
  const first = normalizePRObservation(observation());
  const incomplete = { ...first, checkReferences: undefined };

  assert.throws(
    () => reconcilePRSnapshot(first, incomplete),
    (error: unknown) => error instanceof PRObservationError,
  );
});

test("an explicit empty reference collection removes current references", () => {
  const first = normalizePRObservation(observation());
  const delta = reconcilePRSnapshot(first, observation({ checkReferences: [], reviewReferences: [] }));

  assert.equal(delta.kind, "state-change");
  assert.deepEqual(delta.snapshot.checkReferences, []);
  assert.deepEqual(delta.snapshot.reviewReferences, []);
  assert.ok(delta.changes.some(({ kind }) => kind === "check-reference-change"));
  assert.ok(delta.changes.some(({ kind }) => kind === "review-reference-change"));
});

test("reference history stays bounded across a generation rollover", () => {
  const limits = {
    maxOutputBytes: 65_536,
    maxErrorMessageBytes: 4_096,
    maxEvidenceBytes: 32_768,
    maxSignals: 1,
    maxReviewClaims: 1,
  } as const;
  const first = normalizePRObservation(observation(), { limits });
  const delta = reconcilePRSnapshot(first, observation({ headSha: secondHead, checkReferences: [{ id: "check-2" }] }), {
    limits,
  });

  assert.equal(delta.kind, "generation-rollover");
  assert.equal(delta.snapshot.checkReferences.length, 1);
  assert.equal(delta.snapshot.checkReferences[0]?.id, "check-2");
  assert.equal(delta.snapshot.generationHistory.length, 2);
});

test("a rollover plus base change emits both meaningful delta kinds", () => {
  const first = normalizePRObservation(observation());
  const delta = reconcilePRSnapshot(first, observation({ headSha: secondHead, baseRef: "release" }));

  assert.ok(delta.changes.some(({ kind }) => kind === "generation-rollover"));
  assert.ok(delta.changes.some(({ kind }) => kind === "base-ref-change"));
});

test("malformed required fields fail closed with stable diagnostics", () => {
  const invalid = {
    state: "open",
    draft: false,
    merged: false,
  };

  assert.throws(
    () => normalizePRObservation(invalid),
    (error: unknown) => {
      assert.ok(error instanceof PRObservationError);
      assert.deepEqual(
        error.diagnostics.map(({ path, code }) => `${path}:${code}`),
        ["baseRef:missing-field", "headSha:missing-field", "prNumber:missing-field", "repository:missing-field"],
      );
      return true;
    },
  );
});

test("GitHub-shaped nested base/head observations retain exact identity", () => {
  const snapshot = normalizePRObservation({
    repository: { full_name: repository },
    number: 7,
    base: { ref: "main", sha: "c".repeat(40) },
    head: { ref: "feature/example", sha: firstHead },
    state: "open",
    draft: false,
    mergedAt: null,
  });

  assert.equal(snapshot.baseRef, "main");
  assert.equal(snapshot.baseSha, "c".repeat(40));
  assert.equal(snapshot.headRef, "feature/example");
  assert.equal(snapshot.merged, false);
});

test("snapshot and delta serialization remain bounded", () => {
  const snapshot: PRSnapshot = normalizePRObservation(observation());
  assert.throws(
    () =>
      serializePRSnapshot(snapshot, {
        maxOutputBytes: 32,
        maxErrorMessageBytes: 64,
        maxEvidenceBytes: 64,
        maxSignals: 4,
        maxReviewClaims: 4,
      }),
    MakamiError,
  );
});
