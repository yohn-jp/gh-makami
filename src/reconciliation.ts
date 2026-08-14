import {
  DEFAULT_LIMITS,
  MakamiError,
  createPRGeneration,
  digestJson,
  getPRGenerationKey,
  serializeBounded,
  stableStringify,
  type Currentness,
  type EvidenceRef,
  type JsonObject,
  type JsonValue,
  type PRGeneration,
  type PRGenerationIdentity,
  type Repository,
  type Resolution,
  type RuntimeLimits,
  type SignalLifecycle,
  type SourceRef,
} from "./contracts.js";

export const PR_SNAPSHOT_KIND = "pr-snapshot" as const;
export const PR_SNAPSHOT_SCHEMA_VERSION = 0 as const;

export type PullRequestState = "open" | "closed";
export type PullRequestLifecycle = "open" | "draft" | "closed" | "merged";
export type MergeabilityState = "mergeable" | "conflicting" | "unknown" | "pending";
export type ConflictState = "clear" | "conflicting" | "unknown" | "pending";
export type PRReferenceKind = "check" | "review";
export type ObservationCompleteness = "complete" | "partial" | "unknown";

export interface PRReferenceInput {
  readonly id?: string | number;
  readonly nodeId?: string;
  readonly node_id?: string;
  readonly databaseId?: string | number;
  readonly database_id?: string | number;
  readonly headSha?: string;
  readonly head_sha?: string;
  readonly generation?: Partial<PRGenerationIdentity>;
  readonly repository?: string;
  readonly prNumber?: number;
  readonly number?: number;
  readonly state?: unknown;
  readonly status?: unknown;
  readonly conclusion?: unknown;
  readonly currentness?: unknown;
  readonly resolution?: unknown;
  readonly source?: unknown;
  readonly url?: unknown;
  readonly htmlUrl?: unknown;
  readonly html_url?: unknown;
  readonly detailsUrl?: unknown;
  readonly details_url?: unknown;
  readonly digest?: unknown;
  readonly locator?: unknown;
  readonly mediaType?: unknown;
  readonly media_type?: unknown;
  readonly sizeBytes?: unknown;
  readonly size_bytes?: unknown;
  readonly [key: string]: unknown;
}

/**
 * The observer accepts a small GitHub-shaped projection rather than a GitHub
 * client. Fetching, authentication, retries, and mutation remain outside
 * Makami's observation contract.
 */
export interface PullRequestObservation {
  readonly repository?: unknown;
  readonly prNumber?: unknown;
  readonly number?: unknown;
  readonly baseRef?: unknown;
  readonly baseSha?: unknown;
  readonly base?: unknown;
  readonly headSha?: unknown;
  readonly headRef?: unknown;
  readonly head?: unknown;
  readonly state?: unknown;
  readonly draft?: unknown;
  readonly isDraft?: unknown;
  readonly merged?: unknown;
  readonly mergedAt?: unknown;
  readonly merged_at?: unknown;
  readonly mergeability?: unknown;
  readonly mergeable?: unknown;
  readonly mergeableState?: unknown;
  readonly mergeable_state?: unknown;
  readonly conflicts?: unknown;
  readonly hasConflicts?: unknown;
  readonly conflictPaths?: unknown;
  readonly checkReferences?: unknown;
  readonly checks?: unknown;
  readonly reviewReferences?: unknown;
  readonly reviews?: unknown;
  readonly observedAt?: unknown;
  readonly observed_at?: unknown;
  readonly sourceUrl?: unknown;
  readonly url?: unknown;
  readonly htmlUrl?: unknown;
  readonly html_url?: unknown;
  readonly observation?: unknown;
  readonly [key: string]: unknown;
}

export interface PRNormalizationOptions {
  readonly limits?: RuntimeLimits;
  /** Explicitly supplied observation time; it is volatile metadata. */
  readonly observedAt?: string;
}

export interface PullRequestStatus {
  readonly state: PullRequestState;
  readonly draft: boolean;
  readonly merged: boolean;
  readonly lifecycle: PullRequestLifecycle;
}

export interface MergeabilityObservation {
  readonly state: MergeabilityState;
  /** Provider value is retained only as an observation, never interpreted downstream. */
  readonly providerValue?: boolean | null;
  readonly remoteState?: string;
}

export interface ConflictObservation {
  readonly state: ConflictState;
  readonly paths?: readonly string[];
}

export interface PRObservationReference extends EvidenceRef {
  readonly kind: PRReferenceKind;
  readonly id: string;
  readonly generation: PRGenerationIdentity;
  readonly provenance: {
    readonly kind: "observed";
    readonly source: SourceRef;
    readonly observedAt: string;
  };
  readonly lifecycle: SignalLifecycle;
  /** Exact provider state text, without semantic classification. */
  readonly providerState?: string;
}

export interface GenerationHistoryEntry {
  readonly generation: PRGenerationIdentity;
  readonly currentness: "current" | "superseded";
}

export interface PRSnapshot {
  readonly kind: typeof PR_SNAPSHOT_KIND;
  readonly schemaVersion: typeof PR_SNAPSHOT_SCHEMA_VERSION;
  readonly repository: Repository;
  readonly prNumber: number;
  readonly baseRef: string;
  readonly baseSha?: string;
  readonly headRef?: string;
  readonly headSha: string;
  readonly generation: PRGeneration;
  readonly state: PullRequestState;
  readonly draft: boolean;
  readonly merged: boolean;
  readonly lifecycle: PullRequestLifecycle;
  readonly status: PullRequestStatus;
  readonly mergeability: MergeabilityObservation;
  readonly conflicts: ConflictObservation;
  readonly checkReferences: readonly PRObservationReference[];
  readonly reviewReferences: readonly PRObservationReference[];
  readonly completeness: {
    readonly checks: ObservationCompleteness;
    readonly reviews: ObservationCompleteness;
  };
  readonly source: SourceRef;
  readonly provenance: {
    readonly kind: "observed";
    readonly source: SourceRef;
    readonly observedAt: string;
  };
  readonly generationHistory: readonly GenerationHistoryEntry[];
}

export type PRDiagnosticCode = "missing-field" | "invalid-field" | "identity-mismatch" | "limit-exceeded";

export interface PRObservationDiagnostic {
  readonly code: PRDiagnosticCode;
  readonly path: string;
  readonly message: string;
}

export class PRObservationError extends MakamiError {
  readonly diagnostics: readonly PRObservationDiagnostic[];

  constructor(diagnostics: readonly PRObservationDiagnostic[]) {
    const ordered = sortDiagnostics(diagnostics);
    const message = ordered.map(({ path, message: detail }) => `${path}: ${detail}`).join("; ");
    const code = ordered.some(({ code }) => code === "limit-exceeded") ? "limit-exceeded" : "invalid-input";
    super(code, message || "observation is invalid");
    this.name = "PRObservationError";
    this.diagnostics = ordered;
  }
}

export type PRObservationResult =
  | { readonly ok: true; readonly snapshot: PRSnapshot }
  | { readonly ok: false; readonly diagnostics: readonly PRObservationDiagnostic[] };

export type ReconciliationKind = "initial" | "unchanged" | "state-change" | "generation-rollover";

export type ReconciliationChangeKind =
  | "initial-observation"
  | "generation-rollover"
  | "base-ref-change"
  | "lifecycle-change"
  | "mergeability-change"
  | "conflict-change"
  | "check-reference-change"
  | "review-reference-change";

export interface ReconciliationChange {
  readonly kind: ReconciliationChangeKind;
  readonly path: string;
  readonly before?: JsonValue;
  readonly after?: JsonValue;
}

export interface PRReconciliationDelta {
  readonly kind: ReconciliationKind;
  readonly changed: boolean;
  readonly generation: PRGenerationIdentity;
  readonly previousGeneration?: PRGenerationIdentity;
  readonly changes: readonly ReconciliationChange[];
  readonly snapshot: PRSnapshot;
  readonly diagnostics: readonly PRObservationDiagnostic[];
}

export interface ReconcileRequest {
  readonly previous?: PRSnapshot;
  readonly current: unknown;
  readonly limits?: RuntimeLimits;
  readonly observedAt?: string;
}

const MAX_GENERATION_HISTORY = 64;
const MERGEABILITY_STATES = new Set<MergeabilityState>(["mergeable", "conflicting", "unknown", "pending"]);
const CURRENTNESS_VALUES = new Set<Currentness>(["current", "outdated", "superseded", "unknown"]);
const RESOLUTION_VALUES = new Set<Resolution>(["unresolved", "resolved", "dismissed", "not-applicable", "unknown"]);

/**
 * Normalize one explicit GitHub PR observation into the authoritative v0
 * snapshot. This function never consults process.cwd(), the filesystem, or a
 * remote API, and therefore cannot silently observe another repository.
 */
export function normalizePRObservation(input: unknown, options: PRNormalizationOptions = {}): PRSnapshot {
  const limits = options.limits ?? DEFAULT_LIMITS;
  assertLimits(limits);
  const diagnostics: PRObservationDiagnostic[] = [];
  const { record, outerRepository, outerPrNumber } = unwrapObservation(input, diagnostics);

  const repository = readRepository(record, outerRepository, diagnostics);
  const prNumber = readPrNumber(record, outerPrNumber, diagnostics);
  const baseRef = readOptionalString(record, "baseRef", ["baseRef"], diagnostics);
  const baseSha = readOptionalString(record, "baseSha", ["baseSha"], diagnostics);
  const head = readNestedRecord(record, "head", diagnostics);
  const base = readNestedRecord(record, "base", diagnostics);
  const nestedBaseRef = readOptionalString(base, "base.ref", ["ref"], diagnostics);
  const nestedBaseSha = readOptionalString(base, "base.sha", ["sha"], diagnostics);
  const nestedHeadSha = readOptionalString(head, "head.sha", ["sha"], diagnostics);
  const nestedHeadRef = readOptionalString(head, "head.ref", ["ref"], diagnostics);
  const resolvedBaseRef = reconcileRequiredStringValues(baseRef, nestedBaseRef, "baseRef", "base.ref", diagnostics);
  const resolvedBaseSha = reconcileOptionalStringValues(baseSha, nestedBaseSha, "baseSha", "base.sha", diagnostics);

  const directHeadSha = readOptionalString(record, "headSha", ["headSha"], diagnostics);
  const validDirectHeadSha =
    directHeadSha === undefined ? undefined : validateHeadSha(directHeadSha, "headSha", diagnostics);
  const validNestedHeadSha =
    nestedHeadSha === undefined ? undefined : validateHeadSha(nestedHeadSha, "head.sha", diagnostics);
  const headSha = reconcileRequiredStringValues(
    validDirectHeadSha,
    validNestedHeadSha,
    "headSha",
    "head.sha",
    diagnostics,
  );
  const headRef = reconcileOptionalStringValues(
    readOptionalString(record, "headRef", ["headRef"], diagnostics),
    nestedHeadRef,
    "headRef",
    "head.ref",
    diagnostics,
  );

  const state = readPullRequestState(record, diagnostics);
  const draft = readRequiredBoolean(record, "draft", ["draft", "isDraft"], diagnostics);
  const merged = readMerged(record, diagnostics);
  const observedAt = readObservedAt(record, options, diagnostics);
  const sourceUrl = readOptionalUrl(record, diagnostics);

  // Do not let a constructor error replace the stable, path-addressed
  // diagnostics collected for malformed required identity fields.
  if (diagnostics.length > 0) throw new PRObservationError(diagnostics);

  const generation = createPRGeneration({
    repository,
    prNumber,
    headSha,
    baseRef: resolvedBaseRef,
    ...(observedAt === undefined ? {} : { observedAt }),
  });
  const source = makePullRequestSource(repository, prNumber, sourceUrl);
  const provenance = makeObservedProvenance(source, generation.observedAt);
  const mergeability = normalizeMergeability(record, diagnostics);
  const conflicts = normalizeConflicts(record, diagnostics);

  const checkInput = readReferenceCollection(record, "checkReferences", "checks", diagnostics);
  const reviewInput = readReferenceCollection(record, "reviewReferences", "reviews", diagnostics);
  const checkReferences = normalizeReferences(
    "check",
    checkInput.value,
    checkInput.present,
    generation,
    source,
    generation.observedAt,
    limits,
    diagnostics,
    "checkReferences",
  );
  const reviewReferences = normalizeReferences(
    "review",
    reviewInput.value,
    reviewInput.present,
    generation,
    source,
    generation.observedAt,
    limits,
    diagnostics,
    "reviewReferences",
  );

  if (diagnostics.length > 0) throw new PRObservationError(diagnostics);

  const lifecycle = getPullRequestLifecycle(state, draft, merged);
  const status: PullRequestStatus = { state, draft, merged, lifecycle };
  const snapshot: PRSnapshot = {
    kind: PR_SNAPSHOT_KIND,
    schemaVersion: PR_SNAPSHOT_SCHEMA_VERSION,
    repository,
    prNumber,
    baseRef: resolvedBaseRef,
    ...(resolvedBaseSha === undefined ? {} : { baseSha: resolvedBaseSha }),
    ...(headRef === undefined ? {} : { headRef }),
    headSha,
    generation,
    state,
    draft,
    merged,
    lifecycle,
    status,
    mergeability,
    conflicts,
    checkReferences,
    reviewReferences,
    completeness: {
      checks: getCompleteness(checkInput.present),
      reviews: getCompleteness(reviewInput.present),
    },
    source,
    provenance,
    generationHistory: [{ generation: getGenerationIdentity(generation), currentness: "current" }],
  };
  assertSnapshotWithinLimits(snapshot, limits);
  return snapshot;
}

export function tryNormalizePRObservation(input: unknown, options: PRNormalizationOptions = {}): PRObservationResult {
  try {
    return { ok: true, snapshot: normalizePRObservation(input, options) };
  } catch (error) {
    if (error instanceof PRObservationError) return { ok: false, diagnostics: error.diagnostics };
    throw error;
  }
}

/** Reconcile a previous snapshot against one fresh explicit observation. */
export function reconcilePRSnapshot(
  previous: PRSnapshot | undefined,
  current: unknown,
  options: PRNormalizationOptions = {},
): PRReconciliationDelta {
  const limits = options.limits ?? DEFAULT_LIMITS;
  assertLimits(limits);
  const next = isSnapshotLike(current) ? validateSnapshot(current, limits) : normalizePRObservation(current, options);

  if (previous === undefined) {
    const initialChange: ReconciliationChange = {
      kind: "initial-observation",
      path: "snapshot",
      after: canonicalizePRSnapshot(next, limits),
    };
    const delta: PRReconciliationDelta = {
      kind: "initial",
      changed: true,
      generation: getGenerationIdentity(next.generation),
      changes: [initialChange],
      snapshot: next,
      diagnostics: [],
    };
    assertDeltaWithinLimits(delta, limits);
    return delta;
  }

  const prior = validateSnapshot(previous, limits);
  if (prior.repository !== next.repository || prior.prNumber !== next.prNumber) {
    const diagnostics: PRObservationDiagnostic[] = [];
    if (prior.repository !== next.repository) {
      diagnostics.push(
        diagnostic("identity-mismatch", "repository", "current observation belongs to a different repository"),
      );
    }
    if (prior.prNumber !== next.prNumber) {
      diagnostics.push(
        diagnostic("identity-mismatch", "prNumber", "current observation belongs to a different pull request"),
      );
    }
    throw new PRObservationError(diagnostics);
  }
  const generationChanged = getPRGenerationKey(prior.generation) !== getPRGenerationKey(next.generation);
  const reconciledSnapshot = mergeSnapshotHistory(prior, next, generationChanged, limits);
  const changes = compareSnapshots(prior, reconciledSnapshot, generationChanged);
  const delta: PRReconciliationDelta = {
    kind: generationChanged ? "generation-rollover" : changes.length === 0 ? "unchanged" : "state-change",
    changed: changes.length > 0,
    generation: getGenerationIdentity(reconciledSnapshot.generation),
    ...(generationChanged ? { previousGeneration: getGenerationIdentity(prior.generation) } : {}),
    changes,
    snapshot: reconciledSnapshot,
    diagnostics: [],
  };
  assertDeltaWithinLimits(delta, limits);
  return delta;
}

/** Reconcile two already-normalized snapshots. */
export function reconcilePRSnapshots(
  previous: PRSnapshot | undefined,
  current: PRSnapshot,
  options: PRNormalizationOptions = {},
): PRReconciliationDelta {
  return reconcilePRSnapshot(previous, current, options);
}

export function reconcile(request: ReconcileRequest): PRReconciliationDelta {
  return reconcilePRSnapshot(request.previous, request.current, {
    limits: request.limits,
    observedAt: request.observedAt,
  });
}

/** Canonical snapshot projection; observedAt is intentionally volatile and omitted. */
export function canonicalizePRSnapshot(snapshot: PRSnapshot, limits: RuntimeLimits = DEFAULT_LIMITS): JsonObject {
  const valid = validateSnapshot(snapshot, limits);
  const result: MutableJsonObject = {
    kind: valid.kind,
    schemaVersion: valid.schemaVersion,
    repository: valid.repository,
    prNumber: valid.prNumber,
    baseRef: valid.baseRef,
    headSha: valid.headSha,
    generation: canonicalGeneration(valid.generation),
    state: valid.state,
    draft: valid.draft,
    merged: valid.merged,
    lifecycle: valid.lifecycle,
    status: {
      state: valid.status.state,
      draft: valid.status.draft,
      merged: valid.status.merged,
      lifecycle: valid.status.lifecycle,
    },
    mergeability: canonicalMergeability(valid.mergeability),
    conflicts: canonicalConflicts(valid.conflicts),
    checkReferences: valid.checkReferences.map(canonicalReference),
    reviewReferences: valid.reviewReferences.map(canonicalReference),
    completeness: {
      checks: valid.completeness.checks,
      reviews: valid.completeness.reviews,
    },
    source: canonicalSource(valid.source),
    provenance: {
      kind: "observed",
      source: canonicalSource(valid.provenance.source),
    },
    generationHistory: valid.generationHistory.map((entry) => ({
      generation: canonicalGenerationIdentity(entry.generation),
      currentness: entry.currentness,
    })),
  };
  if (valid.baseSha !== undefined) result.baseSha = valid.baseSha;
  if (valid.headRef !== undefined) result.headRef = valid.headRef;
  return result;
}

/** Serialize a snapshot using stable JSON and the configured hard output bound. */
export function serializePRSnapshot(snapshot: PRSnapshot, limits: RuntimeLimits = DEFAULT_LIMITS): string {
  return serializeBounded(canonicalizePRSnapshot(snapshot, limits), limits);
}

export function getPRSnapshotDigest(snapshot: PRSnapshot): string {
  return digestJson(canonicalizePRSnapshot(snapshot));
}

export function serializeReconciliationDelta(
  delta: PRReconciliationDelta,
  limits: RuntimeLimits = DEFAULT_LIMITS,
): string {
  const result: MutableJsonObject = {
    kind: delta.kind,
    changed: delta.changed,
    generation: canonicalGenerationIdentity(delta.generation),
    changes: delta.changes.map((change) => {
      const value: MutableJsonObject = { kind: change.kind, path: change.path };
      if (change.before !== undefined) value.before = change.before;
      if (change.after !== undefined) value.after = change.after;
      return value;
    }),
    snapshot: canonicalizePRSnapshot(delta.snapshot, limits),
    diagnostics: delta.diagnostics.map(canonicalDiagnostic),
  };
  if (delta.previousGeneration !== undefined)
    result.previousGeneration = canonicalGenerationIdentity(delta.previousGeneration);
  return serializeBounded(result, limits);
}

export function getReconciliationDigest(delta: PRReconciliationDelta): string {
  return digestJson(JSON.parse(serializeReconciliationDelta(delta)) as JsonValue);
}

export function isPRSnapshot(value: unknown): value is PRSnapshot {
  const record = asRecord(value);
  if (record === undefined || !isSnapshotLike(record)) return false;
  const generation = asRecord(record.generation);
  const status = asRecord(record.status);
  const mergeability = asRecord(record.mergeability);
  const conflicts = asRecord(record.conflicts);
  const completeness = asRecord(record.completeness);
  const provenance = asRecord(record.provenance);
  return (
    generation !== undefined &&
    isPRGenerationIdentity(generation) &&
    generation.repository === record.repository &&
    generation.prNumber === record.prNumber &&
    generation.headSha === record.headSha &&
    typeof generation.baseRef === "string" &&
    typeof generation.observedAt === "string" &&
    typeof record.repository === "string" &&
    typeof record.prNumber === "number" &&
    Number.isSafeInteger(record.prNumber) &&
    record.prNumber > 0 &&
    typeof record.baseRef === "string" &&
    typeof record.headSha === "string" &&
    /^[0-9a-fA-F]{40}$/.test(record.headSha) &&
    (record.baseSha === undefined || typeof record.baseSha === "string") &&
    (record.headRef === undefined || typeof record.headRef === "string") &&
    typeof record.state === "string" &&
    (record.state === "open" || record.state === "closed") &&
    typeof record.draft === "boolean" &&
    typeof record.merged === "boolean" &&
    typeof record.lifecycle === "string" &&
    (record.lifecycle === "open" ||
      record.lifecycle === "draft" ||
      record.lifecycle === "closed" ||
      record.lifecycle === "merged") &&
    status !== undefined &&
    status.state === record.state &&
    typeof status.draft === "boolean" &&
    typeof status.merged === "boolean" &&
    typeof status.lifecycle === "string" &&
    (status.lifecycle === "open" ||
      status.lifecycle === "draft" ||
      status.lifecycle === "closed" ||
      status.lifecycle === "merged") &&
    mergeability !== undefined &&
    typeof mergeability.state === "string" &&
    MERGEABILITY_STATES.has(mergeability.state as MergeabilityState) &&
    (mergeability.providerValue === undefined ||
      mergeability.providerValue === null ||
      typeof mergeability.providerValue === "boolean") &&
    (mergeability.remoteState === undefined || typeof mergeability.remoteState === "string") &&
    conflicts !== undefined &&
    typeof conflicts.state === "string" &&
    new Set<ConflictState>(["clear", "conflicting", "unknown", "pending"]).has(conflicts.state as ConflictState) &&
    (conflicts.paths === undefined ||
      (Array.isArray(conflicts.paths) && conflicts.paths.every((path) => typeof path === "string"))) &&
    Array.isArray(record.checkReferences) &&
    record.checkReferences.every(isObservationReference) &&
    Array.isArray(record.reviewReferences) &&
    record.reviewReferences.every(isObservationReference) &&
    completeness !== undefined &&
    (completeness.checks === "complete" || completeness.checks === "partial" || completeness.checks === "unknown") &&
    (completeness.reviews === "complete" || completeness.reviews === "partial" || completeness.reviews === "unknown") &&
    isSourceRef(record.source) &&
    provenance !== undefined &&
    provenance.kind === "observed" &&
    typeof provenance.observedAt === "string" &&
    isSourceRef(provenance.source) &&
    Array.isArray(record.generationHistory) &&
    record.generationHistory.every(isGenerationHistoryEntry)
  );
}

// Friendly aliases keep the public surface discoverable without introducing
// separate implementations or semantics.
export const normalizePullRequestObservation = normalizePRObservation;
export const observePullRequest = normalizePRObservation;
export const reconcilePullRequest = reconcilePRSnapshot;

function unwrapObservation(
  input: unknown,
  diagnostics: PRObservationDiagnostic[],
): { record: RecordValue; outerRepository: unknown; outerPrNumber: unknown } {
  const outer = asRecord(input);
  if (outer === undefined) {
    diagnostics.push(diagnostic("invalid-field", "$", "observation must be an object"));
    return { record: {}, outerRepository: undefined, outerPrNumber: undefined };
  }
  const nested = asRecord(outer.observation);
  if (nested === undefined) {
    return {
      record: outer,
      outerRepository: undefined,
      outerPrNumber: undefined,
    };
  }
  const outerRepository = firstPresent(outer, ["repository"]).value;
  const outerPrNumber = firstPresent(outer, ["prNumber", "number"]).value;
  const nestedRepository = firstPresent(nested, ["repository"]).value;
  const nestedPrNumber = firstPresent(nested, ["prNumber", "number"]).value;
  if (outerRepository !== undefined && nestedRepository !== undefined) {
    const outerName = repositoryValue(outerRepository);
    const nestedName = repositoryValue(nestedRepository);
    if (outerName !== undefined && nestedName !== undefined && outerName !== nestedName) {
      diagnostics.push(
        diagnostic("identity-mismatch", "repository", "explicit repository does not match observation repository"),
      );
    }
  }
  if (outerPrNumber !== undefined && nestedPrNumber !== undefined && outerPrNumber !== nestedPrNumber) {
    diagnostics.push(
      diagnostic("identity-mismatch", "prNumber", "explicit PR number does not match observation PR number"),
    );
  }
  return { record: nested, outerRepository, outerPrNumber };
}

type MutableJsonObject = Record<string, JsonValue>;
type RecordValue = Record<string, unknown>;

interface EvidenceMetadata {
  digest?: string;
  locator?: string;
  mediaType?: string;
  sizeBytes?: number;
}

function asRecord(value: unknown): RecordValue | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as RecordValue;
}

function firstPresent(record: RecordValue | undefined, keys: readonly string[]): { key?: string; value: unknown } {
  if (record === undefined) return { value: undefined };
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return { key, value: record[key] };
  }
  return { value: undefined };
}

function readRepository(record: RecordValue, outerValue: unknown, diagnostics: PRObservationDiagnostic[]): string {
  const value = outerValue === undefined ? firstPresent(record, ["repository"]).value : outerValue;
  const repository = repositoryValue(value);
  if (repository === undefined) {
    diagnostics.push(diagnostic("missing-field", "repository", "explicit repository is required"));
    return "";
  }
  if (repository.length === 0 || repository.trim() !== repository) {
    diagnostics.push(
      diagnostic("invalid-field", "repository", "repository must be a non-empty string without surrounding whitespace"),
    );
  }
  return repository;
}

function repositoryValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  const fullName = record === undefined ? undefined : firstPresent(record, ["full_name", "fullName", "name"]).value;
  return typeof fullName === "string" ? fullName : undefined;
}

function readPrNumber(record: RecordValue, outerValue: unknown, diagnostics: PRObservationDiagnostic[]): number {
  const value = outerValue === undefined ? firstPresent(record, ["prNumber", "number"]).value : outerValue;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    diagnostics.push(
      diagnostic(
        value === undefined ? "missing-field" : "invalid-field",
        "prNumber",
        "explicit PR number must be a positive safe integer",
      ),
    );
    return 0;
  }
  return value;
}

function readNestedRecord(
  record: RecordValue,
  key: string,
  diagnostics: PRObservationDiagnostic[],
): RecordValue | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  const nested = asRecord(value);
  if (nested === undefined)
    diagnostics.push(diagnostic("invalid-field", key, `${key} must be an object when supplied`));
  return nested;
}

function readOptionalString(
  record: RecordValue | undefined,
  path: string,
  keys: readonly string[],
  diagnostics: PRObservationDiagnostic[],
): string | undefined {
  const present = firstPresent(record, keys);
  if (present.value === undefined) return undefined;
  if (typeof present.value !== "string" || present.value.length === 0 || present.value.trim() !== present.value) {
    diagnostics.push(
      diagnostic("invalid-field", path, `${path} must be a non-empty string without surrounding whitespace`),
    );
    return undefined;
  }
  return present.value;
}

function readOptionalUrl(record: RecordValue, diagnostics: PRObservationDiagnostic[]): string | undefined {
  const present = firstPresent(record, ["sourceUrl", "htmlUrl", "html_url", "url"]);
  if (present.value === undefined) return undefined;
  if (typeof present.value !== "string" || present.value.length === 0 || present.value.trim() !== present.value) {
    diagnostics.push(
      diagnostic("invalid-field", "sourceUrl", "sourceUrl must be a non-empty string without surrounding whitespace"),
    );
    return undefined;
  }
  return present.value;
}

function readRequiredBoolean(
  record: RecordValue,
  path: string,
  keys: readonly string[],
  diagnostics: PRObservationDiagnostic[],
): boolean {
  const value = firstPresent(record, keys).value;
  if (typeof value !== "boolean") {
    diagnostics.push(
      diagnostic(value === undefined ? "missing-field" : "invalid-field", path, `${path} must be a boolean`),
    );
    return false;
  }
  return value;
}

function readPullRequestState(record: RecordValue, diagnostics: PRObservationDiagnostic[]): PullRequestState {
  const value = firstPresent(record, ["state"]).value;
  if (value === "open" || value === "closed") return value;
  if (value === "merged") return "closed";
  diagnostics.push(
    diagnostic(value === undefined ? "missing-field" : "invalid-field", "state", "state must be open or closed"),
  );
  return "closed";
}

function readMerged(record: RecordValue, diagnostics: PRObservationDiagnostic[]): boolean {
  const merged = firstPresent(record, ["merged"]);
  if (merged.value !== undefined) {
    if (typeof merged.value !== "boolean") {
      diagnostics.push(diagnostic("invalid-field", "merged", "merged must be a boolean"));
      return false;
    }
    return merged.value;
  }
  const timestamp = firstPresent(record, ["mergedAt", "merged_at"]);
  if (timestamp.value !== undefined) {
    if (timestamp.value !== null && typeof timestamp.value !== "string") {
      diagnostics.push(diagnostic("invalid-field", "mergedAt", "mergedAt must be a string or null"));
      return false;
    }
    return timestamp.value !== null;
  }
  diagnostics.push(diagnostic("missing-field", "merged", "merged or mergedAt is required"));
  return false;
}

function readObservedAt(
  record: RecordValue,
  options: PRNormalizationOptions,
  diagnostics: PRObservationDiagnostic[],
): string | undefined {
  const value = options.observedAt ?? firstPresent(record, ["observedAt", "observed_at"]).value;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    diagnostics.push(
      diagnostic("invalid-field", "observedAt", "observedAt must be a non-empty string without surrounding whitespace"),
    );
    return undefined;
  }
  return value;
}

function validateHeadSha(value: string | undefined, path: string, diagnostics: PRObservationDiagnostic[]): string {
  if (value === undefined) {
    diagnostics.push(diagnostic("missing-field", path, `${path} is required`));
    return "";
  }
  if (!/^[0-9a-fA-F]{40}$/.test(value)) {
    diagnostics.push(diagnostic("invalid-field", path, `${path} must be an exact 40-character hexadecimal SHA`));
    return "";
  }
  return value.toLowerCase();
}

function reconcileRequiredStringValues(
  first: string | undefined,
  second: string | undefined,
  firstPath: string,
  secondPath: string,
  diagnostics: PRObservationDiagnostic[],
): string {
  if (first !== undefined && second !== undefined && first !== second) {
    diagnostics.push(diagnostic("identity-mismatch", firstPath, `${firstPath} does not match ${secondPath}`));
  }
  if (first !== undefined) return first;
  if (second !== undefined) return second;
  diagnostics.push(diagnostic("missing-field", firstPath, `${firstPath} or ${secondPath} is required`));
  return "";
}

function reconcileOptionalStringValues(
  first: string | undefined,
  second: string | undefined,
  firstPath: string,
  secondPath: string,
  diagnostics: PRObservationDiagnostic[],
): string | undefined {
  if (first !== undefined && second !== undefined && first !== second) {
    diagnostics.push(diagnostic("identity-mismatch", firstPath, `${firstPath} does not match ${secondPath}`));
  }
  return first ?? second;
}

function normalizeMergeability(record: RecordValue, diagnostics: PRObservationDiagnostic[]): MergeabilityObservation {
  const explicit = firstPresent(record, ["mergeability"]).value;
  const mergeableStateValue = firstPresent(record, ["mergeableState", "mergeable_state"]).value;
  const mergeableValue = firstPresent(record, ["mergeable"]);
  let explicitState: MergeabilityState | undefined;
  if (explicit !== undefined) {
    if (typeof explicit !== "string" || !MERGEABILITY_STATES.has(explicit as MergeabilityState)) {
      diagnostics.push(diagnostic("invalid-field", "mergeability", "mergeability has an unsupported state"));
    } else {
      explicitState = explicit as MergeabilityState;
    }
  }

  let remoteState: string | undefined;
  let stateFromRemote: MergeabilityState | undefined;
  if (mergeableStateValue !== undefined && mergeableStateValue !== null) {
    if (typeof mergeableStateValue !== "string" || mergeableStateValue.length === 0) {
      diagnostics.push(
        diagnostic("invalid-field", "mergeableState", "mergeableState must be a non-empty string or null"),
      );
    } else {
      remoteState = mergeableStateValue;
      stateFromRemote = mapRemoteMergeability(mergeableStateValue);
    }
  } else if (mergeableStateValue === null) {
    stateFromRemote = "pending";
  }

  let providerValue: boolean | null | undefined;
  let stateFromBoolean: MergeabilityState | undefined;
  if (mergeableValue.value !== undefined) {
    if (mergeableValue.value !== null && typeof mergeableValue.value !== "boolean") {
      diagnostics.push(diagnostic("invalid-field", "mergeable", "mergeable must be a boolean or null"));
    } else {
      providerValue = mergeableValue.value as boolean | null;
      stateFromBoolean = mergeableValue.value === null ? "pending" : mergeableValue.value ? "mergeable" : "conflicting";
    }
  }

  const knownStates = [explicitState, stateFromRemote, stateFromBoolean].filter(
    (value): value is MergeabilityState => value !== undefined,
  );
  const distinctStates = new Set(knownStates);
  if (distinctStates.has("mergeable") && distinctStates.has("conflicting")) {
    diagnostics.push(diagnostic("invalid-field", "mergeability", "mergeability observations contradict each other"));
  }
  const state = explicitState ?? stateFromBoolean ?? stateFromRemote ?? "unknown";
  return {
    state,
    ...(providerValue === undefined ? {} : { providerValue }),
    ...(remoteState === undefined && explicit === undefined ? {} : { remoteState: remoteState ?? String(explicit) }),
  };
}

function mapRemoteMergeability(value: string): MergeabilityState {
  switch (value.toLowerCase()) {
    case "clean":
    case "mergeable":
      return "mergeable";
    case "dirty":
    case "conflicting":
      return "conflicting";
    case "pending":
      return "pending";
    default:
      return "unknown";
  }
}

function normalizeConflicts(record: RecordValue, diagnostics: PRObservationDiagnostic[]): ConflictObservation {
  const value = firstPresent(record, ["conflicts", "hasConflicts"]);
  const pathValue = firstPresent(record, ["conflictPaths"]).value;
  let paths: string[] | undefined;
  if (pathValue !== undefined) {
    if (
      !Array.isArray(pathValue) ||
      pathValue.some((path) => typeof path !== "string" || path.length === 0 || path.trim() !== path)
    ) {
      diagnostics.push(
        diagnostic("invalid-field", "conflictPaths", "conflictPaths must be an array of non-empty strings"),
      );
    } else {
      paths = [...new Set(pathValue)].sort(compareStrings);
    }
  }
  let state: ConflictState;
  if (value.value === undefined) state = paths === undefined ? "unknown" : paths.length === 0 ? "clear" : "conflicting";
  else if (value.value === null) state = "pending";
  else if (typeof value.value === "boolean") state = value.value ? "conflicting" : "clear";
  else {
    diagnostics.push(diagnostic("invalid-field", "conflicts", "conflicts must be a boolean or null"));
    state = "unknown";
  }
  if (state === "clear" && paths !== undefined && paths.length > 0) {
    diagnostics.push(diagnostic("invalid-field", "conflicts", "clear conflicts cannot contain conflict paths"));
  }
  return { state, ...(paths === undefined ? {} : { paths }) };
}

function readReferenceCollection(
  record: RecordValue,
  primary: string,
  alias: string,
  diagnostics: PRObservationDiagnostic[],
): { present: boolean; value: unknown } {
  if (Object.prototype.hasOwnProperty.call(record, primary)) return { present: true, value: record[primary] };
  if (Object.prototype.hasOwnProperty.call(record, alias)) return { present: true, value: record[alias] };
  return { present: false, value: undefined };
}

function normalizeReferences(
  kind: PRReferenceKind,
  value: unknown,
  present: boolean,
  currentGeneration: PRGeneration,
  fallbackSource: SourceRef,
  observedAt: string,
  limits: RuntimeLimits,
  diagnostics: PRObservationDiagnostic[],
  path: string,
): PRObservationReference[] {
  if (!present) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic("invalid-field", path, `${path} must be an array`));
    return [];
  }
  const maximum = kind === "check" ? limits.maxSignals : limits.maxReviewClaims;
  if (value.length > maximum) {
    diagnostics.push(diagnostic("limit-exceeded", path, `${path} exceeds the configured reference limit`));
  }
  const references: PRObservationReference[] = [];
  value.slice(0, maximum).forEach((item, index) => {
    const reference = normalizeReference(
      kind,
      item,
      currentGeneration,
      fallbackSource,
      observedAt,
      diagnostics,
      `${path}[${index}]`,
    );
    if (reference !== undefined) references.push(reference);
  });
  return deduplicateReferences(references, path, diagnostics);
}

function normalizeReference(
  kind: PRReferenceKind,
  value: unknown,
  currentGeneration: PRGeneration,
  fallbackSource: SourceRef,
  observedAt: string,
  diagnostics: PRObservationDiagnostic[],
  path: string,
): PRObservationReference | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    diagnostics.push(diagnostic("invalid-field", path, "reference must be an object"));
    return undefined;
  }
  const idValue = firstPresent(record, ["id", "nodeId", "node_id", "databaseId", "database_id"]);
  const id = normalizeReferenceId(idValue.value);
  if (id === undefined) {
    diagnostics.push(
      diagnostic(
        idValue.value === undefined ? "missing-field" : "invalid-field",
        `${path}.id`,
        "reference id is required",
      ),
    );
    return undefined;
  }
  const generationRecord = asRecord(record.generation);
  const repositoryValueForReference = firstPresent(record, ["repository"]).value;
  const repository =
    repositoryValue(repositoryValueForReference) ??
    (generationRecord === undefined
      ? undefined
      : repositoryValue(firstPresent(generationRecord, ["repository"]).value));
  if (repository !== undefined && repository !== currentGeneration.repository) {
    diagnostics.push(
      diagnostic("identity-mismatch", `${path}.repository`, "reference repository does not match PR repository"),
    );
  }
  const referencePrNumber =
    firstPresent(record, ["prNumber", "number"]).value ??
    (generationRecord === undefined ? undefined : firstPresent(generationRecord, ["prNumber"]).value);
  if (referencePrNumber !== undefined && referencePrNumber !== currentGeneration.prNumber) {
    diagnostics.push(
      diagnostic("identity-mismatch", `${path}.prNumber`, "reference PR number does not match PR number"),
    );
  }
  const rawHeadSha =
    firstPresent(record, ["headSha", "head_sha"]).value ??
    (generationRecord === undefined ? undefined : firstPresent(generationRecord, ["headSha"]).value);
  let headSha = currentGeneration.headSha;
  if (rawHeadSha !== undefined) {
    if (typeof rawHeadSha !== "string" || !/^[0-9a-fA-F]{40}$/.test(rawHeadSha)) {
      diagnostics.push(
        diagnostic(
          "invalid-field",
          `${path}.headSha`,
          "reference headSha must be an exact 40-character hexadecimal SHA",
        ),
      );
    } else {
      headSha = rawHeadSha.toLowerCase();
    }
  }
  const referenceGeneration: PRGenerationIdentity = {
    repository: currentGeneration.repository,
    prNumber: currentGeneration.prNumber,
    headSha,
  };
  const url = readReferenceUrl(record, path, diagnostics);
  const source = readReferenceSource(record, fallbackSource, kind, id, url, path, diagnostics);
  const stateValue = firstPresent(record, ["state", "status", "conclusion"]).value;
  let providerState: string | undefined;
  if (stateValue !== undefined && stateValue !== null) {
    if (typeof stateValue !== "string" || stateValue.length === 0 || stateValue.trim() !== stateValue) {
      diagnostics.push(
        diagnostic("invalid-field", `${path}.state`, "reference state must be a non-empty string when supplied"),
      );
    } else {
      providerState = stateValue;
    }
  }
  const currentness: Currentness = headSha === currentGeneration.headSha ? "current" : "outdated";
  const resolution = readReferenceResolution(record, path, diagnostics);
  const evidence = readEvidenceMetadata(record, path, diagnostics);
  return {
    evidenceId: `${kind}:${id}`,
    source,
    ...evidence,
    kind,
    id,
    generation: referenceGeneration,
    provenance: makeObservedProvenance(source, observedAt),
    lifecycle: { currentness, resolution },
    ...(providerState === undefined ? {} : { providerState }),
  };
}

function normalizeReferenceId(value: unknown): string | undefined {
  if (typeof value === "string") return value.length > 0 && value.trim() === value ? value : undefined;
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
  return undefined;
}

function readReferenceUrl(
  record: RecordValue,
  path: string,
  diagnostics: PRObservationDiagnostic[],
): string | undefined {
  const value = firstPresent(record, ["url", "htmlUrl", "html_url", "detailsUrl", "details_url"]).value;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    diagnostics.push(
      diagnostic("invalid-field", `${path}.url`, "reference URL must be a non-empty string when supplied"),
    );
    return undefined;
  }
  return value;
}

function readReferenceSource(
  record: RecordValue,
  fallback: SourceRef,
  kind: PRReferenceKind,
  id: string,
  url: string | undefined,
  path: string,
  diagnostics: PRObservationDiagnostic[],
): SourceRef {
  const sourceRecord = asRecord(record.source);
  if (sourceRecord === undefined && record.source !== undefined) {
    diagnostics.push(diagnostic("invalid-field", `${path}.source`, "reference source must be an object"));
    return fallback;
  }
  if (sourceRecord === undefined) {
    return {
      provider: "github",
      resourceType: kind,
      resourceId: id,
      ...(url === undefined ? {} : { url }),
    };
  }
  const provider = sourceRecord.provider;
  const resourceType = sourceRecord.resourceType;
  const resourceId = sourceRecord.resourceId;
  if (
    provider !== "github" ||
    typeof resourceType !== "string" ||
    resourceType.length === 0 ||
    typeof resourceId !== "string" ||
    resourceId.length === 0
  ) {
    diagnostics.push(
      diagnostic("invalid-field", `${path}.source`, "reference source must be a valid GitHub source reference"),
    );
    return fallback;
  }
  const sourceUrl = sourceRecord.url;
  if (
    sourceUrl !== undefined &&
    (typeof sourceUrl !== "string" || sourceUrl.length === 0 || sourceUrl.trim() !== sourceUrl)
  ) {
    diagnostics.push(
      diagnostic("invalid-field", `${path}.source.url`, "source URL must be a non-empty string when supplied"),
    );
  }
  return {
    provider: "github",
    resourceType,
    resourceId,
    ...(typeof sourceUrl === "string" ? { url: sourceUrl } : url === undefined ? {} : { url }),
  };
}

function readReferenceResolution(
  record: RecordValue,
  path: string,
  diagnostics: PRObservationDiagnostic[],
): Resolution {
  const value = record.resolution;
  if (value === undefined) return "unknown";
  if (typeof value === "string" && RESOLUTION_VALUES.has(value as Resolution)) return value as Resolution;
  diagnostics.push(diagnostic("invalid-field", `${path}.resolution`, "reference resolution has an unsupported state"));
  return "unknown";
}

function readEvidenceMetadata(
  record: RecordValue,
  path: string,
  diagnostics: PRObservationDiagnostic[],
): EvidenceMetadata {
  const result: EvidenceMetadata = {};
  for (const [field, aliases] of [
    ["digest", ["digest"]],
    ["locator", ["locator"]],
    ["mediaType", ["mediaType", "media_type"]],
  ] as const) {
    const value = firstPresent(record, aliases).value;
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
      diagnostics.push(
        diagnostic("invalid-field", `${path}.${field}`, `${field} must be a non-empty string when supplied`),
      );
      continue;
    }
    if (field === "digest") result.digest = value;
    else if (field === "locator") result.locator = value;
    else result.mediaType = value;
  }
  const size = firstPresent(record, ["sizeBytes", "size_bytes"]).value;
  if (size !== undefined) {
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      diagnostics.push(
        diagnostic("invalid-field", `${path}.sizeBytes`, "sizeBytes must be a non-negative safe integer"),
      );
    } else {
      result.sizeBytes = size;
    }
  }
  return result;
}

function deduplicateReferences(
  references: readonly PRObservationReference[],
  path: string,
  diagnostics: PRObservationDiagnostic[],
): PRObservationReference[] {
  const byKey = new Map<string, PRObservationReference>();
  for (const reference of references) {
    const key = referenceKey(reference);
    const existing = byKey.get(key);
    if (
      existing !== undefined &&
      stableStringify(canonicalReference(existing)) !== stableStringify(canonicalReference(reference))
    ) {
      diagnostics.push(
        diagnostic("invalid-field", path, "duplicate reference identities have conflicting observations"),
      );
      continue;
    }
    byKey.set(key, reference);
  }
  return [...byKey.values()].sort((left, right) => compareStrings(referenceKey(left), referenceKey(right)));
}

function mergeSnapshotHistory(
  previous: PRSnapshot,
  current: PRSnapshot,
  generationChanged: boolean,
  limits: RuntimeLimits,
): PRSnapshot {
  const currentKey = getPRGenerationKey(current.generation);
  const history = new Map<string, GenerationHistoryEntry>();
  history.set(currentKey, { generation: getGenerationIdentity(current.generation), currentness: "current" });
  for (const entry of [
    ...current.generationHistory,
    ...previous.generationHistory,
    {
      generation: getGenerationIdentity(previous.generation),
      currentness: "superseded" as const,
    },
  ]) {
    const key = getPRGenerationKey(entry.generation);
    if (key !== currentKey && !history.has(key)) {
      history.set(key, { generation: entry.generation, currentness: "superseded" });
    }
  }
  const orderedHistory = [...history.values()].slice(
    0,
    Math.min(MAX_GENERATION_HISTORY, Math.max(2, limits.maxSignals)),
  );
  const oldCheckReferences = previous.checkReferences.map((reference) =>
    generationChanged && getPRGenerationKey(reference.generation) === getPRGenerationKey(previous.generation)
      ? markSuperseded(reference)
      : reference,
  );
  const oldReviewReferences = previous.reviewReferences.map((reference) =>
    generationChanged && getPRGenerationKey(reference.generation) === getPRGenerationKey(previous.generation)
      ? markSuperseded(reference)
      : reference,
  );
  const checkReferences = mergeReferences(
    previous,
    current,
    oldCheckReferences,
    current.checkReferences,
    "check",
    generationChanged,
    limits.maxSignals,
  );
  const reviewReferences = mergeReferences(
    previous,
    current,
    oldReviewReferences,
    current.reviewReferences,
    "review",
    generationChanged,
    limits.maxReviewClaims,
  );
  const result: PRSnapshot = {
    ...current,
    checkReferences,
    reviewReferences,
    generationHistory: orderedHistory,
  };
  assertSnapshotWithinLimits(result, limits);
  return result;
}

function mergeReferences(
  previous: PRSnapshot,
  current: PRSnapshot,
  historical: readonly PRObservationReference[],
  fresh: readonly PRObservationReference[],
  kind: PRReferenceKind,
  generationChanged: boolean,
  maximum: number,
): PRObservationReference[] {
  const currentKey = getPRGenerationKey(current.generation);
  const values = new Map<string, PRObservationReference>();
  for (const reference of historical) {
    if (generationChanged || getPRGenerationKey(reference.generation) !== currentKey) {
      values.set(referenceKey(reference), reference);
    }
  }
  const priorCurrent = (kind === "check" ? previous.checkReferences : previous.reviewReferences).filter(
    (reference) => getPRGenerationKey(reference.generation) === currentKey,
  );
  const shouldCarryPriorCurrent =
    !generationChanged &&
    (kind === "check" ? current.completeness.checks === "unknown" : current.completeness.reviews === "unknown");
  if (shouldCarryPriorCurrent) {
    for (const reference of priorCurrent) values.set(referenceKey(reference), reference);
  }
  for (const reference of fresh) values.set(referenceKey(reference), reference);
  const currentReferences = [...values.values()]
    .filter((reference) => getPRGenerationKey(reference.generation) === currentKey)
    .sort((left, right) => compareStrings(referenceKey(left), referenceKey(right)));
  const historicalReferences = [...values.values()]
    .filter((reference) => getPRGenerationKey(reference.generation) !== currentKey)
    .sort((left, right) => compareStrings(referenceKey(left), referenceKey(right)));
  return [...currentReferences, ...historicalReferences].slice(0, maximum);
}

function markSuperseded(reference: PRObservationReference): PRObservationReference {
  return {
    ...reference,
    lifecycle: { ...reference.lifecycle, currentness: "superseded" },
  };
}

function compareSnapshots(
  previous: PRSnapshot,
  current: PRSnapshot,
  generationChanged: boolean,
): ReconciliationChange[] {
  const changes: ReconciliationChange[] = [];
  if (generationChanged) {
    changes.push({
      kind: "generation-rollover",
      path: "generation",
      before: canonicalGenerationIdentity(previous.generation),
      after: canonicalGenerationIdentity(current.generation),
    });
  }
  if (previous.baseRef !== current.baseRef) {
    changes.push({ kind: "base-ref-change", path: "baseRef", before: previous.baseRef, after: current.baseRef });
  }
  if (stableStringify(canonicalStatus(previous.status)) !== stableStringify(canonicalStatus(current.status))) {
    changes.push({
      kind: "lifecycle-change",
      path: "status",
      before: canonicalStatus(previous.status),
      after: canonicalStatus(current.status),
    });
  }
  if (
    stableStringify(canonicalMergeability(previous.mergeability)) !==
    stableStringify(canonicalMergeability(current.mergeability))
  ) {
    changes.push({
      kind: "mergeability-change",
      path: "mergeability",
      before: canonicalMergeability(previous.mergeability),
      after: canonicalMergeability(current.mergeability),
    });
  }
  if (
    stableStringify(canonicalConflicts(previous.conflicts)) !== stableStringify(canonicalConflicts(current.conflicts))
  ) {
    changes.push({
      kind: "conflict-change",
      path: "conflicts",
      before: canonicalConflicts(previous.conflicts),
      after: canonicalConflicts(current.conflicts),
    });
  }
  if (
    stableStringify(currentGenerationReferences(previous, "check")) !==
    stableStringify(currentGenerationReferences(current, "check"))
  ) {
    changes.push({
      kind: "check-reference-change",
      path: "checkReferences",
      before: currentGenerationReferences(previous, "check"),
      after: currentGenerationReferences(current, "check"),
    });
  }
  if (
    stableStringify(currentGenerationReferences(previous, "review")) !==
    stableStringify(currentGenerationReferences(current, "review"))
  ) {
    changes.push({
      kind: "review-reference-change",
      path: "reviewReferences",
      before: currentGenerationReferences(previous, "review"),
      after: currentGenerationReferences(current, "review"),
    });
  }
  return changes;
}

function currentGenerationReferences(snapshot: PRSnapshot, kind: PRReferenceKind): JsonValue {
  const key = getPRGenerationKey(snapshot.generation);
  const references = (kind === "check" ? snapshot.checkReferences : snapshot.reviewReferences)
    .filter((reference) => getPRGenerationKey(reference.generation) === key)
    .map(canonicalReference);
  return references;
}

function validateSnapshot(value: unknown, limits: RuntimeLimits): PRSnapshot {
  if (!isPRSnapshot(value)) {
    throw new PRObservationError([diagnostic("invalid-field", "snapshot", "previous value is not a PR snapshot")]);
  }
  const snapshot = value as unknown as PRSnapshot;
  assertSnapshotWithinLimits(snapshot, limits);
  return snapshot;
}

function isSnapshotLike(value: unknown): value is RecordValue {
  const record = asRecord(value);
  return (
    record !== undefined && record.kind === PR_SNAPSHOT_KIND && record.schemaVersion === PR_SNAPSHOT_SCHEMA_VERSION
  );
}

function isPRGenerationIdentity(value: unknown): value is PRGenerationIdentity {
  const record = asRecord(value);
  return (
    record !== undefined &&
    typeof record.repository === "string" &&
    typeof record.prNumber === "number" &&
    Number.isSafeInteger(record.prNumber) &&
    record.prNumber > 0 &&
    typeof record.headSha === "string" &&
    /^[0-9a-fA-F]{40}$/.test(record.headSha)
  );
}

function isSourceRef(value: unknown): value is SourceRef {
  const record = asRecord(value);
  return (
    record !== undefined &&
    record.provider === "github" &&
    typeof record.resourceType === "string" &&
    record.resourceType.length > 0 &&
    typeof record.resourceId === "string" &&
    record.resourceId.length > 0 &&
    (record.url === undefined || typeof record.url === "string")
  );
}

function isObservationReference(value: unknown): value is PRObservationReference {
  const record = asRecord(value);
  const generation = record === undefined ? undefined : asRecord(record.generation);
  const provenance = record === undefined ? undefined : asRecord(record.provenance);
  const lifecycle = record === undefined ? undefined : asRecord(record.lifecycle);
  return (
    record !== undefined &&
    (record.kind === "check" || record.kind === "review") &&
    typeof record.id === "string" &&
    typeof record.evidenceId === "string" &&
    isSourceRef(record.source) &&
    generation !== undefined &&
    isPRGenerationIdentity(generation) &&
    provenance !== undefined &&
    provenance.kind === "observed" &&
    typeof provenance.observedAt === "string" &&
    isSourceRef(provenance.source) &&
    lifecycle !== undefined &&
    typeof lifecycle.currentness === "string" &&
    CURRENTNESS_VALUES.has(lifecycle.currentness as Currentness) &&
    typeof lifecycle.resolution === "string" &&
    RESOLUTION_VALUES.has(lifecycle.resolution as Resolution)
  );
}

function isGenerationHistoryEntry(value: unknown): value is GenerationHistoryEntry {
  const record = asRecord(value);
  return (
    record !== undefined &&
    isPRGenerationIdentity(record.generation) &&
    (record.currentness === "current" || record.currentness === "superseded")
  );
}

function assertSnapshotWithinLimits(snapshot: PRSnapshot, limits: RuntimeLimits): void {
  if (
    snapshot.checkReferences.length > limits.maxSignals ||
    snapshot.reviewReferences.length > limits.maxReviewClaims
  ) {
    throw new PRObservationError([
      diagnostic("limit-exceeded", "snapshot.references", "snapshot references exceed configured limits"),
    ]);
  }
  if (snapshot.generationHistory.length > MAX_GENERATION_HISTORY) {
    throw new PRObservationError([
      diagnostic("limit-exceeded", "snapshot.generationHistory", "generation history exceeds configured limit"),
    ]);
  }
  serializePRSnapshotUnchecked(snapshot, limits);
}

function assertDeltaWithinLimits(delta: PRReconciliationDelta, limits: RuntimeLimits): void {
  serializeReconciliationDeltaUnchecked(delta, limits);
}

function serializePRSnapshotUnchecked(snapshot: PRSnapshot, limits: RuntimeLimits): string {
  return serializeBounded(canonicalizeSnapshotUnchecked(snapshot), limits);
}

function serializeReconciliationDeltaUnchecked(delta: PRReconciliationDelta, limits: RuntimeLimits): string {
  const result: MutableJsonObject = {
    kind: delta.kind,
    changed: delta.changed,
    generation: canonicalGenerationIdentity(delta.generation),
    changes: delta.changes.map((change) => {
      const value: MutableJsonObject = { kind: change.kind, path: change.path };
      if (change.before !== undefined) value.before = change.before;
      if (change.after !== undefined) value.after = change.after;
      return value;
    }),
    snapshot: canonicalizeSnapshotUnchecked(delta.snapshot),
    diagnostics: delta.diagnostics.map(canonicalDiagnostic),
  };
  if (delta.previousGeneration !== undefined)
    result.previousGeneration = canonicalGenerationIdentity(delta.previousGeneration);
  return serializeBounded(result, limits);
}

function canonicalizeSnapshotUnchecked(snapshot: PRSnapshot): JsonObject {
  const result: MutableJsonObject = {
    kind: snapshot.kind,
    schemaVersion: snapshot.schemaVersion,
    repository: snapshot.repository,
    prNumber: snapshot.prNumber,
    baseRef: snapshot.baseRef,
    headSha: snapshot.headSha,
    generation: canonicalGeneration(snapshot.generation),
    state: snapshot.state,
    draft: snapshot.draft,
    merged: snapshot.merged,
    lifecycle: snapshot.lifecycle,
    status: canonicalStatus(snapshot.status),
    mergeability: canonicalMergeability(snapshot.mergeability),
    conflicts: canonicalConflicts(snapshot.conflicts),
    checkReferences: snapshot.checkReferences.map(canonicalReference),
    reviewReferences: snapshot.reviewReferences.map(canonicalReference),
    completeness: { checks: snapshot.completeness.checks, reviews: snapshot.completeness.reviews },
    source: canonicalSource(snapshot.source),
    provenance: { kind: "observed", source: canonicalSource(snapshot.provenance.source) },
    generationHistory: snapshot.generationHistory.map((entry) => ({
      generation: canonicalGenerationIdentity(entry.generation),
      currentness: entry.currentness,
    })),
  };
  if (snapshot.baseSha !== undefined) result.baseSha = snapshot.baseSha;
  if (snapshot.headRef !== undefined) result.headRef = snapshot.headRef;
  return result;
}

function canonicalGeneration(generation: PRGeneration): JsonObject {
  return {
    repository: generation.repository,
    prNumber: generation.prNumber,
    headSha: generation.headSha,
    baseRef: generation.baseRef,
  };
}

function canonicalGenerationIdentity(generation: PRGenerationIdentity): JsonObject {
  return { repository: generation.repository, prNumber: generation.prNumber, headSha: generation.headSha };
}

function canonicalStatus(status: PullRequestStatus): JsonObject {
  return { state: status.state, draft: status.draft, merged: status.merged, lifecycle: status.lifecycle };
}

function canonicalMergeability(value: MergeabilityObservation): JsonObject {
  const result: MutableJsonObject = { state: value.state };
  if (value.providerValue !== undefined) result.providerValue = value.providerValue;
  if (value.remoteState !== undefined) result.remoteState = value.remoteState;
  return result;
}

function canonicalConflicts(value: ConflictObservation): JsonObject {
  const result: MutableJsonObject = { state: value.state };
  if (value.paths !== undefined) result.paths = [...value.paths];
  return result;
}

function canonicalSource(source: SourceRef): JsonObject {
  const result: MutableJsonObject = {
    provider: source.provider,
    resourceType: source.resourceType,
    resourceId: source.resourceId,
  };
  if (source.url !== undefined) result.url = source.url;
  return result;
}

function canonicalReference(reference: PRObservationReference): JsonObject {
  const result: MutableJsonObject = {
    evidenceId: reference.evidenceId,
    source: canonicalSource(reference.source),
    kind: reference.kind,
    id: reference.id,
    generation: canonicalGenerationIdentity(reference.generation),
    provenance: { kind: "observed", source: canonicalSource(reference.provenance.source) },
    lifecycle: { currentness: reference.lifecycle.currentness, resolution: reference.lifecycle.resolution },
  };
  if (reference.digest !== undefined) result.digest = reference.digest;
  if (reference.locator !== undefined) result.locator = reference.locator;
  if (reference.mediaType !== undefined) result.mediaType = reference.mediaType;
  if (reference.sizeBytes !== undefined) result.sizeBytes = reference.sizeBytes;
  if (reference.providerState !== undefined) result.providerState = reference.providerState;
  return result;
}

function canonicalDiagnostic(diagnosticValue: PRObservationDiagnostic): JsonObject {
  return { code: diagnosticValue.code, path: diagnosticValue.path, message: diagnosticValue.message };
}

function makePullRequestSource(repository: string, prNumber: number, url: string | undefined): SourceRef {
  return {
    provider: "github",
    resourceType: "pull-request",
    resourceId: `${repository}#${prNumber}`,
    ...(url === undefined ? {} : { url }),
  };
}

function makeObservedProvenance(
  source: SourceRef,
  observedAt: string,
): {
  readonly kind: "observed";
  readonly source: SourceRef;
  readonly observedAt: string;
} {
  return { kind: "observed", source, observedAt };
}

function getGenerationIdentity(generation: PRGeneration): PRGenerationIdentity {
  return { repository: generation.repository, prNumber: generation.prNumber, headSha: generation.headSha };
}

function getPullRequestLifecycle(state: PullRequestState, draft: boolean, merged: boolean): PullRequestLifecycle {
  if (merged) return "merged";
  if (state === "closed") return "closed";
  return draft ? "draft" : "open";
}

function getCompleteness(present: boolean): ObservationCompleteness {
  return present ? "complete" : "unknown";
}

function referenceKey(reference: Pick<PRObservationReference, "kind" | "id" | "generation">): string {
  return `${reference.kind}:${getPRGenerationKey(reference.generation)}:${reference.id}`;
}

function diagnostic(code: PRDiagnosticCode, path: string, message: string): PRObservationDiagnostic {
  return { code, path, message };
}

function sortDiagnostics(diagnostics: readonly PRObservationDiagnostic[]): PRObservationDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const pathOrder = compareStrings(left.path, right.path);
    if (pathOrder !== 0) return pathOrder;
    const codeOrder = compareStrings(left.code, right.code);
    return codeOrder !== 0 ? codeOrder : compareStrings(left.message, right.message);
  });
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertLimits(limits: RuntimeLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  }
}
