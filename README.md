# gh-makami

`gh-makami` is the JSON-first contract layer for GitHub pull-request
operational observation. It defines stable PR-generation identity, distinct
signal families, evidence references, review claims, provenance, deterministic
serialization, and finite output/error limits. It does not fetch GitHub state,
interpret review correctness, or orchestrate remediation.

The same executable works as the standalone `gh-makami` command and as the
GitHub CLI extension command `gh makami`.

## Install

```bash
npm install -g gh-makami
```

## Usage

```bash
gh-makami --help
gh-makami --version
gh-makami --contract

# When installed as a GitHub CLI extension:
gh makami --contract
```

The public TypeScript contracts are exported from the package root:

```ts
import { createPRGeneration, getPRGenerationKey, stableStringify, type Signal } from "gh-makami";
```

The machine contract identifier is `gh-makami/contracts/v0`. JSON object keys
are sorted lexicographically, array order is preserved, and SHA-256 digests
are calculated over compact UTF-8 canonical JSON. Collection ordering must be
canonicalized with the exported sort helpers before serialization.

`ReviewClaim.body` is intentionally opaque. The contract records its source,
location, lifecycle, and digest without assigning category, severity,
validity, or remediation correctness.

### Authority boundaries

- Mottainai owns intent, timing, and remediation/session orchestration.
- gh-inari owns governed Issue/PR contracts and GitHub mutation.
- Nawabari owns Git worktrees, branches, commits, and pushes.
- Suzukuri owns bounded semantic projection of selected evidence.
- gh-makami owns observed PR operational reality and its identity, lifecycle,
  provenance, and reconciliation contracts.

Provider-specific observation and all downstream semantic interpretation are
follow-up work in the Epic #3 dependency sequence.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
