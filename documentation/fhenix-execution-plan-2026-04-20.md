# Fhenix Execution Plan

Date: 2026-04-20

This plan turns the top 10 product issues into an execution order that can be implemented without thrashing across contracts, backend, frontend, and docs.

## Current Progress

Completed in the current hardening batch:

- Frontend CoFHE SDK migration to `@cofhe/sdk@0.4.0`
- Frontend typecheck/build hardening
- Frontend and backend route compatibility fixes
- Contract fix for invalid bids poisoning encrypted lowest-bid trackers
- Contract fix for invalid bids counting toward RFQ/Vickrey participation thresholds
- RFQ buyer finalization now uses encrypted lowest-bidder tracking instead of vendor-shared proof bundles
- RFQ escrow release and reclaim flows now wait for verified transfer confirmation before mutating settlement state
- Browser auth moved away from persistent access-token storage
- Bid backup reduced to session-scoped ciphertext metadata
- Dev role-switch route disabled by default and only re-enabled with `ALLOW_DEV_AUTH_ROUTES=true` in local development
- Exact CoFHE/Fhenix version pinning in active workspaces

Still open from the top-10 list:

1. Transfer verification is still not a strict state gate for RFQ winner stake/refund/slash flows or the remaining protocols
2. Remaining auth orchestration is still too client-driven
3. Adversarial and liveness test coverage is still incomplete
4. Config/doc drift outside the touched files still needs final cleanup
5. Raw `uint64` UX is still exposed in user workflows
6. Winner selection and decrypt flows are still too manual

## Workstreams

### Stream A: Contract Correctness

Scope:

- `fehenix-contract/contracts/SealRFQ.sol`
- `fehenix-contract/contracts/SealVickrey.sol`
- `fehenix-contract/test/*`

Tasks:

1. Exclude invalid bids from plaintext participation counters and liveness thresholds.
2. Extend transfer verification gating from RFQ escrow/payment flows to the remaining settlement and stake paths.
3. Add adversarial tests for invalid bids, RFQ tie handling, failed transfer verification, and timeout/cancel paths.

Acceptance criteria:

- Invalid bids do not affect counts, rankings, or completion conditions.
- Buyer-side finalization is deterministic after the bidding and reveal windows close.
- Settlement state cannot advance unless transfer verification succeeds, with RFQ escrow/payment paths already serving as the current baseline.
- Contract tests prove the negative cases, not only the happy path.

### Stream B: Backend/Auth Hardening

Scope:

- `fehenix_backend/api/auth`
- `fehenix_backend/auth`
- `fehenix_backend/lib`
- `fehenix_backend/FHENIX_API.md`

Tasks:

1. Keep browser auth cookie-first and document the optional Bearer path for server callers.
2. Move more role/session resolution server-side so frontend state becomes observational instead of authoritative.
3. Add focused API tests for role switching, session refresh, and auth failure recovery.
4. Finish environment and chain-config normalization around Sepolia defaults.

Acceptance criteria:

- Browser auth works without persistent token storage.
- Role changes succeed through the production route only.
- Session recovery works after refresh and rejects invalid role/session transitions.
- Docs and env examples match actual runtime behavior.

### Stream C: Frontend Operator Flow

Scope:

- `frontend/app`
- `frontend/contexts`
- `frontend/hooks`
- `frontend/lib`

Tasks:

1. Replace raw micro-unit entry with token-denominated forms and conversion helpers.
2. Collapse decrypt, proof generation, and winner/finalization submission into a guided single path.
3. Improve transaction state, failure recovery, and operator diagnostics.
4. Remove any remaining sensitive persistence that is not required for resumability.

Acceptance criteria:

- Buyers and vendors do not need to reason about raw `uint64` values.
- The app surfaces one clear next action per auction state.
- Frontend transaction helpers are covered by compatibility checks against backend routes.

### Stream D: Docs and Release Readiness

Scope:

- `README.md`
- `documentation/*`
- `fehenix-contract/README.md`
- `fehenix_backend/FHENIX_API.md`

Tasks:

1. Align privacy claims with the actual reveal/finalization model.
2. Publish one canonical Sepolia environment matrix.
3. Record current residual risks and unsupported toolchain warnings.
4. Keep setup and operator docs aligned with shipped code after each workstream lands.

Acceptance criteria:

- Docs do not overstate confidentiality or automation.
- Sepolia setup is consistent across frontend, backend, and contract docs.
- Release notes clearly separate fixed items from known blockers.

## Implementation Order

### Phase 1: Stabilize What Ships

Priority:

1. Auth/storage hardening
2. Dev-route shutdown
3. Exact SDK/version policy
4. Build/type/test baseline

Status: in progress, mostly complete in this batch

Exit criteria:

- `frontend`: `tsc` and `next build` pass
- `fehenix_backend`: `tsc` and `next build` pass
- `fehenix-contract`: `hardhat compile` and `hardhat test` pass

### Phase 2: Remove Contract Correctness Gaps

Priority:

1. Transfer verification gating
2. Adversarial contract tests
3. RFQ finalization redesign prep

Status: in progress; RFQ buyer finalization and escrow/payment gating landed, remaining settlement paths and adversarial coverage still open

Exit criteria:

- Verification failure leaves settlement state unchanged
- Test suite covers failure-path regressions

### Phase 3: Operator Flow Cleanup

Priority:

1. Token-denominated inputs
2. Guided decrypt/proof/winner flow
3. Better state/error UX

Status: protocol baseline is stable enough to start after the remaining contract correctness work

Exit criteria:

- Operator flows are linear and recoverable
- User-facing amounts use normal token units

### Phase 4: Auth and Release Readiness

Priority:

1. Auth/API smoke coverage
2. Final doc/privacy alignment
3. Remaining release-readiness cleanup

Status: parallelizable after the remaining contract changes

Exit criteria:

- Browser/session auth paths are explicitly tested
- Release docs match shipped behavior

## Immediate Next Steps

1. Extend transfer verification gating to the remaining RFQ stake and timeout flows.
2. Add adversarial coverage for the new encrypted lowest-bidder finalization path.
3. Add auth/API smoke coverage for refresh and production role switching.
4. Finish the remaining doc cleanup around privacy claims and environment setup.
