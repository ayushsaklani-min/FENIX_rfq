# Fhenix Product Audit

Date: 2026-04-20

## Current State

The product is beyond prototype stage but not production-safe. The core paths exist across contracts, backend, and frontend, but there is drift between the contract model, the backend transaction surface, the frontend CoFHE integration, and the public docs.

What is now verified in the repo:

- `frontend` builds successfully with Next.js production build.
- `frontend` passes `npx tsc --noEmit`.
- `fehenix_backend` passes `npx tsc --noEmit`.
- `fehenix_backend` builds successfully.
- `fehenix-contract` compiles successfully.
- `fehenix-contract` tests pass locally (`22 passing`), with a Hardhat warning on unsupported Node `v25.2.1`.

What was fixed during this pass:

- Frontend CoFHE SDK integration was moved from mixed `0.2.x` and `0.4.x` usage to a consistent `@cofhe/sdk@0.4.0` surface.
- Frontend TypeScript resolution was changed from `node` to `bundler` so package `exports` resolve to published `dist/*.d.ts` instead of raw SDK source files.
- The global `ignoreBuildErrors` bypass was removed from the Next config.
- Frontend transaction helpers were aligned with backend endpoints for Vickrey bid submission and escrow release.
- Backend client typing was fixed for the actual provider shape in `lib/fhenixClient.ts`.
- Network examples were updated from legacy Fhenix RPC placeholders to actual Sepolia defaults.
- Deployment docs were updated to the current `deploy.ts --network eth-sepolia` entrypoint.
- Invalid encrypted bids no longer poison the encrypted lowest-bid trackers in RFQ and Vickrey.
- Invalid RFQ and Vickrey bids no longer satisfy plaintext participation thresholds such as `bidCount` and `minBidCount`.
- Direct RFQ winner selection now tracks the encrypted lowest bidder on-chain, so the buyer can finalize from contract-defined artifacts without a vendor-shared proof package.
- RFQ payment release, creator escrow reclaim, and winner escrow claim now keep escrow state pending until transfer verification is confirmed.
- Browser auth now prefers same-origin httpOnly cookies, and legacy `localStorage.accessToken` state is purged on use.
- Bid workflow backup data now uses session-scoped ciphertext metadata instead of persistent plaintext bid storage.
- `/api/auth/dev/switch-role` now requires both `NODE_ENV=development` and `ALLOW_DEV_AUTH_ROUTES=true`, with `/api/auth/switch-role` used for real role changes.
- CoFHE/Fhenix package versions are now exact in the frontend and contract workspaces, and the Hardhat peer dependency set was restored so compile/test stay reproducible.

## Fix Checklist

### P0: Correctness and security

- [x] Stop invalid bids from satisfying plaintext participation thresholds such as `bidCount` and `minBidCount` checks in `SealRFQ.sol` and `SealVickrey.sol`.
- [x] Redesign RFQ winner selection so the buyer can finalize without relying on bidder-controlled ciphertext access.
- [ ] Gate settlement state changes on transfer verification instead of mutating state first and confirming later. RFQ escrow release/reclaim paths are now gated, but winner stake/refund/slash flows still use the older optimistic model.
- [x] Remove persistent access-token storage and plaintext bid-amount backups from browser persistence. Remaining bid-resume metadata is now session-scoped.
- [x] Eliminate or hard-disable the `/api/auth/dev/switch-role` flow outside explicit local development.
- [x] Pin CoFHE/Fhenix package versions exactly across frontend and contracts. The backend has no CoFHE/Fhenix package dependency today.

### P1: Product and protocol consistency

- [ ] Align docs with actual privacy guarantees after reveal/finalization. Current docs overstate confidentiality.
- [ ] Align Dutch auction docs with the implemented model. The current flow is not a fully encrypted price-discovery path.
- [ ] Normalize chain configuration across `.env.example`, frontend providers, backend providers, deployment scripts, and docs.
- [ ] Replace raw uint64 user inputs with token-denominated UX helpers, formatting, and validation.
- [ ] Reduce the manual decrypt/proof/winner-selection workflow to a guided single-path operator flow.
- [ ] Move role/auth orchestration server-side where possible instead of relying on client-only state transitions.

### P2: Reliability and maintainability

- [ ] Investigate webpack chunk circular-dependency warnings in the frontend build.
- [ ] Clean up stale dependencies and proxy/config drift in the frontend.
- [ ] Add explicit smoke tests for frontend transaction helper to backend route compatibility.
- [ ] Add contract-level tests covering invalid bids, blocked winner selection, and transfer-verification failure paths.
- [ ] Document a single canonical environment matrix for local, Sepolia, and future production deployments.

## Concrete Plan

### Phase 1: Stabilize the shipped build

Objective: remove silent failure paths and make local development reflect actual runtime behavior.

- Lock versions across all packages.
- Keep `frontend` and `fehenix_backend` typecheck green in CI.
- Remove any remaining dev-only auth shortcuts from non-local builds.
- Add a compatibility test for frontend transaction helper endpoints.

Exit criteria:

- Clean frontend build without type bypasses.
- Clean backend build.
- Documented Sepolia environment defaults.

### Phase 2: Fix protocol correctness

Objective: stop invalid or blocked auction outcomes.

- Patch contract bid validation so invalid bids never mutate auction state.
- Extend transfer verification gating from RFQ escrow/payment paths to the remaining settlement and stake-handling flows.
- Expand integration tests for invalid and adversarial flows.

Exit criteria:

- A lowest valid bid cannot be displaced by an invalid bid.
- Invalid bids cannot satisfy RFQ or Vickrey participation thresholds.
- Buyer can always progress winner selection after bidding closes.
- RFQ escrow release and reclaim state stays unchanged until transfer verification succeeds, and the remaining settlement flows are explicitly tracked as follow-up work.

### Phase 3: Harden privacy and auth

Objective: bring implementation in line with product claims.

- Remove plaintext bid storage from browser persistence.
- Scope access/refresh tokens to safer storage and session boundaries.
- Reword privacy claims where decrypted values are intentionally revealed.
- Restrict or remove development auth endpoints outside local environments.

Exit criteria:

- No plaintext bid amounts in browser persistent storage.
- Docs accurately describe what stays confidential and when disclosure occurs.

### Phase 4: Improve operator UX

Objective: reduce failure-prone manual steps in buyer/vendor flows.

- Add token-unit inputs with conversion and validation.
- Guide decrypt and proof submission through a single flow with explicit state transitions.
- Surface clearer auction state and failure diagnostics in the UI.

Exit criteria:

- Buyers and vendors do not need raw uint64 reasoning during normal use.
- Winner selection and reveal flows have clear next actions and error recovery.

## Implementation Specs

### Spec A: Contract bid validation

Problem:
Bid range checks now protect both encrypted ranking and plaintext participation thresholds in RFQ and Vickrey. Any follow-on changes must preserve that behavior.

Required behavior:

- Reject bids outside configured bounds before they satisfy participation thresholds or auction liveness checks.
- Cover both RFQ and Vickrey flows.
- Add regression tests for below-minimum, above-maximum, and valid bids.

Definition of done:

- Invalid bids do not affect counts, rankings, or winner state.
- Tests demonstrate the failure before fix and pass after fix.

### Spec B: RFQ winner finalization model

Problem:
RFQ finalization previously depended on bidder-owned ciphertext access and off-chain proof sharing.

Required behavior:

- Buyer must be able to verify/select the winner after the reveal window from contract-defined encrypted artifacts.
- The protocol must define who can decrypt the lowest bid and lowest bidder handles and at which stage.
- Frontend and backend flows must match the revised contract interface.

Definition of done:

- Buyer-side winner selection works deterministically from protocol state.
- Contract, backend route, and frontend UI share the same reveal/finalization model.

### Spec C: Transfer verification gating

Problem:
Observed transfer checks are not authoritative state gates.

Required behavior:

- Settlement state transitions must only happen after verified transfer evidence.
- Failure or timeout in verification must leave state unchanged or explicitly pending.
- Reconciliation logic must not imply success before verification.

Definition of done:

- Payment release and confirmation paths are idempotent and verification-gated.
- Audit trail reflects pending, verified, and failed verification distinctly.

### Spec D: Browser-side secret handling

Problem:
Sensitive amounts and token material are stored too loosely in browser persistence.

Required behavior:

- Persist only what is needed for resumability.
- Prefer in-memory or session-scoped storage for sensitive operational data.
- Document exactly what is stored client-side and why.

Definition of done:

- Persistent storage contains no unnecessary plaintext bid data.
- Threat model and storage choices are documented.

## Recommended Agent Split

Use separate workers with disjoint ownership:

- Contracts worker: `fehenix-contract/contracts`, `fehenix-contract/test`
- Backend worker: `fehenix_backend/lib`, `fehenix_backend/routes`, `fehenix_backend/tx`
- Frontend worker: `frontend/app`, `frontend/contexts`, `frontend/lib`
- Docs worker: `README.md`, `documentation/*`, `fehenix_backend/FHENIX_API.md`, `fehenix-contract/README.md`

This keeps protocol, API, UI, and docs changes independent enough to run in parallel without constant merge conflict.

## Residual Risks

- The frontend build still reports webpack chunk circular-dependency warnings. They are non-blocking but should be traced before production.
- Contract correctness issues remain the largest blocker to production readiness.
- RFQ transfer verification is only partially authoritative today. Escrow release/reclaim paths are gated, but winner stake acceptance, stake refunds, and stake slashing still mutate protocol state before transfer verification is confirmed.
- The local toolchain uses Node `v25.2.1`, while Hardhat warns that this version is not officially supported.
- Browser auth is now cookie-first, but the backend still accepts Bearer headers for non-browser callers. That dual path should remain documented and intentionally tested.
- Session-scoped bid backup metadata still exists for resumability. It no longer stores plaintext amounts, but it remains visible to same-session XSS or shared-browser access.
