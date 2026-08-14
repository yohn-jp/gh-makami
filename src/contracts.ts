import { createHash } from "node:crypto";

/**
 * The machine contract is versioned independently from the npm package. A
 * package patch release may fix implementation details without changing the
 * JSON contract consumed by an orchestrator.
 */
export const MACHINE_CONTRACT_NAME = "gh-makami" as const;
export const MACHINE_CONTRACT_VERSION = 0 as const;
export const MACHINE_CONTRACT_IDENTIFIER = "gh-makami/contracts/v0" as const;

// Short aliases make the contract identity convenient for integrations while
// keeping the descriptive names above as the canonical exports.
export const CONTRACT_ID = MACHINE_CONTRACT_IDENTIFIER;
export const CONTRACT_VERSION = MACHINE_CONTRACT_VERSION;

export interface MachineContractIdentifier {
  readonly name: typeof MACHINE_CONTRACT_NAME;
  readonly version: typeof MACHINE_CONTRACT_VERSION;
  readonly identifier: typeof MACHINE_CONTRACT_IDENTIFIER;
}

export const MACHINE_CONTRACT: MachineContractIdentifier = Object.freeze({
  name: MACHINE_CONTRACT_NAME,
  version: MACHINE_CONTRACT_VERSION,
  identifier: MACHINE_CONTRACT_IDENTIFIER,
});

export type CapabilityStability = "stable" | "experimental";

export interface CapabilityDescriptor {
  readonly id: string;
  readonly version: number;
  readonly stability: CapabilityStability;
  readonly description: string;
}

export interface CapabilitySchema {
  readonly contract: MachineContractIdentifier;
  readonly capabilities: readonly CapabilityDescriptor[];
}

const CAPABILITY_DESCRIPTORS = [
  {
    id: "pr-generation",
    version: 0,
    stability: "stable",
    description: "Identity for a pull-request head generation.",
  },
  {
    id: "pr-reconciliation",
    version: 0,
    stability: "stable",
    description: "Bounded deterministic current-state snapshots and generation deltas.",
  },
  {
    id: "signals",
    version: 0,
    stability: "stable",
    description: "Discriminated operational signal families.",
  },
  {
    id: "evidence-provenance",
    version: 0,
    stability: "stable",
    description: "Source references and explicit observed or derived provenance.",
  },
  {
    id: "review-claims",
    version: 0,
    stability: "stable",
    description: "Opaque, provenance-preserving review claims.",
  },
  {
    id: "deterministic-json",
    version: 0,
    stability: "stable",
    description: "Canonical JSON serialization and SHA-256 digests.",
  },
  {
    id: "bounded-output",
    version: 0,
    stability: "stable",
    description: "Finite output and error limits.",
  },
] as const satisfies readonly CapabilityDescriptor[];

export const CAPABILITY_SCHEMA: CapabilitySchema = Object.freeze({
  contract: MACHINE_CONTRACT,
  capabilities: CAPABILITY_DESCRIPTORS,
});

export function getCapabilitySchema(): CapabilitySchema {
  return {
    contract: { ...MACHINE_CONTRACT },
    capabilities: CAPABILITY_DESCRIPTORS.map((capability) => ({ ...capability })),
  };
}

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

export type Repository = string;

export interface PRGenerationIdentity {
  readonly repository: Repository;
  readonly prNumber: number;
  readonly headSha: string;
}

export interface PRGeneration extends PRGenerationIdentity {
  readonly baseRef: string;
  readonly observedAt: string;
}

export type PRGenerationInput = PRGenerationIdentity & {
  readonly baseRef: string;
  readonly observedAt?: string;
};

export function createPRGeneration(input: PRGenerationInput): PRGeneration {
  assertNonEmptyString(input.repository, "repository");
  assertPositiveInteger(input.prNumber, "prNumber");
  assertNonEmptyString(input.headSha, "headSha");
  assertNonEmptyString(input.baseRef, "baseRef");

  const observedAt = input.observedAt ?? new Date().toISOString();
  assertNonEmptyString(observedAt, "observedAt");

  return {
    repository: input.repository,
    prNumber: input.prNumber,
    headSha: input.headSha,
    baseRef: input.baseRef,
    observedAt,
  };
}

/**
 * The key deliberately contains only repository, PR number, and exact head
 * SHA. Base-ref changes and observation timestamps do not create a new head
 * generation identity.
 */
export function getPRGenerationKey(generation: PRGenerationIdentity): string {
  assertNonEmptyString(generation.repository, "repository");
  assertPositiveInteger(generation.prNumber, "prNumber");
  assertNonEmptyString(generation.headSha, "headSha");
  return `${generation.repository}#${generation.prNumber}@${generation.headSha}`;
}

export const prGenerationKey = getPRGenerationKey;

export function getPRGenerationIdentity(generation: PRGeneration): PRGenerationIdentity {
  return {
    repository: generation.repository,
    prNumber: generation.prNumber,
    headSha: generation.headSha,
  };
}

export type SourceProvider = "github";

/** Identity of an upstream resource. It contains no downstream interpretation. */
export interface SourceRef {
  readonly provider: SourceProvider;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly url?: string;
}

/** A bounded pointer to source evidence; it is not a semantic finding. */
export interface EvidenceRef {
  readonly evidenceId: string;
  readonly source: SourceRef;
  readonly digest?: string;
  readonly locator?: string;
  readonly mediaType?: string;
  readonly sizeBytes?: number;
}

export interface ObservedProvenance {
  readonly kind: "observed";
  readonly source: SourceRef;
  readonly observedAt: string;
}

export interface DerivedProvenance {
  readonly kind: "derived";
  readonly component: string;
  readonly componentVersion: string;
  readonly sourceEvidence: readonly EvidenceRef[];
}

export type Provenance = ObservedProvenance | DerivedProvenance;

export type Currentness = "current" | "outdated" | "superseded" | "unknown";
export type Resolution = "unresolved" | "resolved" | "dismissed" | "not-applicable" | "unknown";

export interface SignalLifecycle {
  readonly currentness: Currentness;
  readonly resolution: Resolution;
}

export interface CodeLocation {
  readonly path: string;
  readonly startLine?: number;
  readonly startColumn?: number;
  readonly endLine?: number;
  readonly endColumn?: number;
  readonly side?: "LEFT" | "RIGHT";
}

export type SignalKind =
  | "check"
  | "workflow"
  | "annotation"
  | "review-submission"
  | "review-thread"
  | "comment"
  | "mergeability"
  | "conflict"
  | "commit-status";

export type SignalType = SignalKind;

export interface SignalEnvelope {
  readonly id: string;
  readonly generation: PRGenerationIdentity;
  readonly source: SourceRef;
  readonly provenance: Provenance;
  readonly lifecycle: SignalLifecycle;
  readonly evidenceRefs?: readonly EvidenceRef[];
  readonly location?: CodeLocation;
}

export type CheckStatus = "queued" | "in-progress" | "completed" | "unknown";
export type CheckConclusion =
  "success" | "failure" | "neutral" | "cancelled" | "timed-out" | "action-required" | "skipped" | "stale" | "unknown";

export interface CheckSignal extends SignalEnvelope {
  readonly kind: "check";
  readonly check: {
    readonly name: string;
    readonly status: CheckStatus;
    readonly conclusion?: CheckConclusion;
    readonly detailsUrl?: string;
  };
}

export type WorkflowStatus = "queued" | "in-progress" | "completed" | "waiting" | "unknown";

export interface WorkflowSignal extends SignalEnvelope {
  readonly kind: "workflow";
  readonly workflow: {
    readonly runId: string;
    readonly name?: string;
    readonly status: WorkflowStatus;
    readonly conclusion?: CheckConclusion;
    readonly detailsUrl?: string;
  };
}

export type AnnotationLevel = "notice" | "warning" | "failure" | "unknown";

export interface AnnotationSignal extends SignalEnvelope {
  readonly kind: "annotation";
  readonly annotation: {
    readonly annotationId: string;
    readonly level: AnnotationLevel;
    readonly message: string;
    readonly title?: string;
  };
}

export type ReviewSubmissionState =
  "approved" | "changes-requested" | "commented" | "dismissed" | "pending" | "unknown";

export interface ReviewSubmissionSignal extends SignalEnvelope {
  readonly kind: "review-submission";
  readonly review: {
    readonly reviewId: string;
    readonly state: ReviewSubmissionState;
    readonly author?: string;
    readonly submittedAt?: string;
  };
}

export interface ReviewThreadSignal extends SignalEnvelope {
  readonly kind: "review-thread";
  readonly thread: {
    readonly threadId: string;
    readonly commentIds: readonly string[];
    readonly isResolved: boolean;
    readonly isOutdated: boolean;
  };
}

export interface CommentSignal extends SignalEnvelope {
  readonly kind: "comment";
  readonly comment: {
    readonly commentId: string;
    readonly author?: string;
    readonly bodyDigest: string;
    readonly bodyRef?: EvidenceRef;
    readonly createdAt?: string;
    readonly updatedAt?: string;
  };
}

export type Mergeability = "mergeable" | "conflicting" | "unknown" | "unstable";

export interface MergeabilitySignal extends SignalEnvelope {
  readonly kind: "mergeability";
  readonly mergeability: {
    readonly state: Mergeability;
    readonly remoteState?: string;
  };
}

export interface ConflictSignal extends SignalEnvelope {
  readonly kind: "conflict";
  readonly conflict: {
    readonly conflicted: boolean;
    readonly paths?: readonly string[];
  };
}

export interface CommitStatusSignal extends SignalEnvelope {
  readonly kind: "commit-status";
  readonly status: {
    readonly context: string;
    readonly state: "pending" | "success" | "failure" | "error" | "unknown";
    readonly targetUrl?: string;
  };
}

/**
 * Signal families intentionally stay distinct. Consumers must branch on
 * `kind` instead of treating every remote fact as a semantic finding.
 */
export type Signal =
  | CheckSignal
  | WorkflowSignal
  | AnnotationSignal
  | ReviewSubmissionSignal
  | ReviewThreadSignal
  | CommentSignal
  | MergeabilitySignal
  | ConflictSignal
  | CommitStatusSignal;

export interface ReviewClaim {
  readonly claimId: string;
  readonly generation: PRGenerationIdentity;
  readonly source: SourceRef;
  readonly provenance: ObservedProvenance;
  /** Opaque review text. No category, severity, validity, or remediation is assigned. */
  readonly body: string;
  readonly bodyDigest: string;
  readonly bodyRef?: EvidenceRef;
  readonly lifecycle: SignalLifecycle;
  readonly author?: string;
  readonly location?: CodeLocation;
  readonly createdAt: string;
  readonly updatedAt?: string;
}

export function createReviewClaim(input: Omit<ReviewClaim, "bodyDigest">): ReviewClaim {
  assertNonEmptyString(input.claimId, "claimId");
  assertNonEmptyString(input.body, "body");
  return {
    ...input,
    bodyDigest: sha256Digest(input.body),
  };
}

export function getSignalIdentity(signal: Pick<Signal, "kind" | "id" | "generation">): string {
  return `${getPRGenerationKey(signal.generation)}:${signal.kind}:${signal.id}`;
}

export function isSignal(value: unknown): value is Signal {
  if (!isRecord(value) || typeof value.kind !== "string" || typeof value.id !== "string") return false;
  return SIGNAL_KINDS.has(value.kind as SignalKind);
}

const SIGNAL_KINDS = new Set<SignalKind>([
  "check",
  "workflow",
  "annotation",
  "review-submission",
  "review-thread",
  "comment",
  "mergeability",
  "conflict",
  "commit-status",
]);

export interface RuntimeLimits {
  readonly maxOutputBytes: number;
  readonly maxErrorMessageBytes: number;
  readonly maxEvidenceBytes: number;
  readonly maxSignals: number;
  readonly maxReviewClaims: number;
}

export const DEFAULT_LIMITS: RuntimeLimits = Object.freeze({
  maxOutputBytes: 64 * 1024,
  maxErrorMessageBytes: 4 * 1024,
  maxEvidenceBytes: 32 * 1024,
  maxSignals: 256,
  maxReviewClaims: 256,
});

export function withLimits(overrides: Partial<RuntimeLimits> = {}): RuntimeLimits {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  assertValidLimits(limits);
  return Object.freeze(limits);
}

export type RuntimeErrorCode = "invalid-input" | "unsupported" | "limit-exceeded" | "serialization-failed" | "internal";

export interface BoundedError {
  readonly code: RuntimeErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export class MakamiError extends Error {
  readonly code: RuntimeErrorCode;
  readonly retryable: boolean;

  constructor(code: RuntimeErrorCode, message: string, options: { readonly retryable?: boolean } = {}) {
    super(message);
    this.name = "MakamiError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }

  toBoundedError(limits: RuntimeLimits = DEFAULT_LIMITS): BoundedError {
    assertValidLimits(limits);
    return {
      code: this.code,
      message: truncateUtf8(this.message, limits.maxErrorMessageBytes),
      retryable: this.retryable,
    };
  }
}

export function toBoundedError(error: unknown, limits: RuntimeLimits = DEFAULT_LIMITS): BoundedError {
  assertValidLimits(limits);
  if (error instanceof MakamiError) return error.toBoundedError(limits);
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "internal",
    message: truncateUtf8(message, limits.maxErrorMessageBytes),
    retryable: false,
  };
}

/**
 * Canonical JSON rules: object keys are sorted lexicographically, array order
 * is preserved, whitespace is omitted, and non-JSON values are rejected.
 */
export function stableStringify(value: unknown): string {
  return stringifyJson(value, new WeakSet<object>());
}

export const canonicalJson = stableStringify;

export function sha256Digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function digestJson(value: unknown): string {
  return sha256Digest(stableStringify(value));
}

export function serializeBounded(value: unknown, limits: RuntimeLimits = DEFAULT_LIMITS): string {
  assertValidLimits(limits);
  const serialized = stableStringify(value);
  if (Buffer.byteLength(serialized, "utf8") > limits.maxOutputBytes) {
    throw new MakamiError("limit-exceeded", `serialized output exceeds ${limits.maxOutputBytes} bytes`);
  }
  return serialized;
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new RangeError("maxBytes must be a positive safe integer");
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= maxBytes) return value;

  const marker = Buffer.from("…", "utf8");
  if (maxBytes < marker.byteLength) return ".".repeat(maxBytes);

  const availableBytes = maxBytes - marker.byteLength;
  let prefix = "";
  let prefixBytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (prefixBytes + characterBytes > availableBytes) break;
    prefix += character;
    prefixBytes += characterBytes;
  }
  return `${prefix}${marker.toString("utf8")}`;
}

export function sortSignals(signals: readonly Signal[]): Signal[] {
  return [...signals].sort((left, right) => compareStrings(getSignalIdentity(left), getSignalIdentity(right)));
}

export function sortReviewClaims(claims: readonly ReviewClaim[]): ReviewClaim[] {
  return [...claims].sort((left, right) => {
    const leftKey = `${getPRGenerationKey(left.generation)}:${left.claimId}`;
    const rightKey = `${getPRGenerationKey(right.generation)}:${right.claimId}`;
    return compareStrings(leftKey, rightKey);
  });
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function stringifyJson(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new MakamiError("serialization-failed", "JSON numbers must be finite");
    return JSON.stringify(value);
  }

  if (typeof value !== "object") {
    throw new MakamiError("serialization-failed", "value is not JSON serializable");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(value)) {
    throw new MakamiError("serialization-failed", "value must be a plain JSON object");
  }
  if (ancestors.has(value)) throw new MakamiError("serialization-failed", "cyclic values are not JSON serializable");
  ancestors.add(value);

  let serialized: string;
  if (Array.isArray(value)) {
    serialized = `[${value.map((item) => stringifyJson(item, ancestors)).join(",")}]`;
  } else {
    const entries = Object.entries(value).sort(([left], [right]) => compareStrings(left, right));
    serialized = `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stringifyJson(item, ancestors)}`)
      .join(",")}}`;
  }

  ancestors.delete(value);
  return serialized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new MakamiError("invalid-input", `${name} must be a non-empty string without surrounding whitespace`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MakamiError("invalid-input", `${name} must be a positive safe integer`);
  }
}

function assertValidLimits(limits: RuntimeLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer`);
    }
  }
}
