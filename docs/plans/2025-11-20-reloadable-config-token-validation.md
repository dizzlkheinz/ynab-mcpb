# Reloadable Config & Token Validation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make config parsing reloadable for env-mutation tests/CI, harden token validation against malformed responses, and confirm integration runs with a valid YNAB token.

**Architecture:** Parse env vars on-demand via `loadConfig()` (with a backward-compatible `config` singleton), inject per-server config instances instead of module globals, and wrap YNAB token validation failures (including non-JSON responses) into `AuthenticationError` with clear messaging.

**Tech Stack:** Node + TypeScript, Zod, dotenv, Vitest, YNAB SDK, esbuild.

### Task 1: Reloadable config loader

**Files:**
- Modify: `src/server/config.ts`
- Modify: `src/server/__tests__/config.test.ts`

**Step 1: Write failing test**  
Add a test that calls `loadConfig()` twice after mutating `process.env.YNAB_ACCESS_TOKEN` (without re-importing the module) and expects the second call to return the updated token.

**Step 2: Run test to verify failure**  
Run `npx vitest run src/server/__tests__/config.test.ts` and confirm the new test fails because the loader is still tied to initial state.

**Step 3: Implement reloadable loader**  
Keep the Zod schema and explicit `config` singleton, but ensure `loadConfig()` re-parses `process.env` on every call (optionally allowing an env override for tests) and throws `ValidationError` on failure; keep `import 'dotenv/config'` so `.env` is loaded for Node execution.

**Step 4: Re-run targeted test**  
Re-run `npx vitest run src/server/__tests__/config.test.ts` to confirm the reloadable behavior passes.

### Task 2: Inject per-instance config into YNABMCPServer

**Files:**
- Modify: `src/server/YNABMCPServer.ts`
- Modify: `src/server/__tests__/YNABMCPServer.test.ts`
- Modify: `src/server/__tests__/server-startup.integration.test.ts`

**Step 1: Add/adjust tests**  
Add coverage that changing `process.env.YNAB_ACCESS_TOKEN` before constructing a new `YNABMCPServer` produces a server wired to the new token (no module cache reset), and update expectations to align with `ValidationError` from `loadConfig()` where appropriate.

**Step 2: Run tests to see failures**  
Run `npx vitest run src/server/__tests__/YNABMCPServer.test.ts src/server/__tests__/server-startup.integration.test.ts`.

**Step 3: Apply code changes**  
Ensure the constructor stores `const configInstance = loadConfig()` and uses it for YNAB API creation, token validation, and tool execution auth; remove any lingering usage of the `config` singleton for runtime behavior.

**Step 4: Re-run the affected tests**  
Re-run the same Vitest targets to verify per-instance config wiring passes.

### Task 3: Token validation resilience

**Files:**
- Modify: `src/server/YNABMCPServer.ts`
- Modify: `src/server/__tests__/server-startup.integration.test.ts`

**Step 1: Write failing test**  
Mock `ynab.API().user.getUser` to reject with a `SyntaxError`/HTML-shaped error and expect `validateToken()` to reject with `AuthenticationError("Unexpected response from YNAB during token validation")` instead of surfacing the raw syntax failure.

**Step 2: Run test to confirm failure**  
Run `npx vitest run src/server/__tests__/server-startup.integration.test.ts`.

**Step 3: Implement graceful handling**  
Wrap token validation to catch non-JSON/SyntaxError cases (or responses lacking expected shape) and throw `AuthenticationError` with the clear message while preserving existing 401/403 mapping.

**Step 4: Re-run validation tests**  
Re-run the targeted integration test to ensure the new mapping passes.

### Task 4: Test alignment & runner portability

**Files:**
- Modify: `src/server/__tests__/config.test.ts`
- Modify: `scripts/run-throttled-integration-tests.js`

**Step 1: Align config test patterns**  
Update any assertions relying on module-level parsing side effects to use `vi.resetModules()` + `loadConfig()` explicitly for reload checks; keep singleton expectations where intentional.

**Step 2: Harden integration runner on Windows**  
Change the throttled runner to spawn Vitest via a platform-portable path (e.g., `node` + resolved `vitest` bin) to avoid `spawn EINVAL` with `.cmd` on Windows.

**Step 3: Run quick smoke**  
Run `node scripts/run-throttled-integration-tests.js --help` or kick a single file to ensure the wrapper executes without path errors.

### Task 5: Full verification

**Files/Commands:**
- Commands: `npm test`, `npm run test:integration:core` (with `YNAB_ACCESS_TOKEN` set), optionally `npm run test:integration:domain`.

**Step 1: Run unit suite**  
Execute `npm test` to ensure unit coverage stays green.

**Step 2: Run core integrations with real token**  
Execute `npm run test:integration:core` using a known-good `YNAB_ACCESS_TOKEN`; capture any regressions.

**Step 3: Optional extended coverage**  
If time permits, run `npm run test:integration:domain` for broader confidence; note any skips or rate-limit impacts.
