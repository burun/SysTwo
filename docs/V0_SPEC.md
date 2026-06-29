# SysTwo V0 Spec

Status: draft  
Date: 2026-06-27  
Target: open-source project

This document describes the intended V0 product and technical contract. SysTwo is currently pre-alpha; statements written as "must" or "should" are design requirements for implementation, not a claim that the current repository already satisfies them.

## 1. Product Thesis

SysTwo is an MCP-based delegation layer for agentic coding workflows.

It helps a high-value controller agent safely delegate bounded coding work to lower-cost runner providers. It routes work by token value, risk, permissions, and required evidence.

The core thesis:

> High-value tokens should own judgment. Lower-cost tokens should do bounded execution. SysTwo should enforce the boundary.

## 2. Public Positioning

SysTwo should be presented as:

```text
An open-source MCP server for safe, cost-aware delegation in coding workflows.
```

It should not be presented as:

- a personal Codex + CodeBuddy glue layer
- a general multi-agent framework
- a model router
- an observability product
- a coding agent UI

Codex + CodeBuddy is the reference workflow, not the product boundary.

## 3. V0 Architecture

```text
Controller agent
  -> SysTwo MCP server
    -> router
    -> policy engine
    -> usage estimator
    -> provider adapter
      -> temporary git worktree
      -> code search / edits / tests / logs
    -> structured result
  -> Controller agent final review
```

V0 reference setup:

```text
Controller: Codex
Provider: CodeBuddy
Demo provider: mock
```

Design requirement: controller and provider must be replaceable.

## 4. Package Shape

Language: TypeScript  
Runtime: Node.js  
Distribution: npm package  
Primary surface: MCP server  
Secondary surface: CLI commands

Commands:

```bash
systwo doctor
systwo mcp
systwo demo
systwo run
```

`systwo run` is optional for early V0 and mainly supports debugging or CI experiments.

## 5. Installation Goals

Global install:

```bash
npm install -g systwo
systwo doctor
systwo mcp
```

Zero-config demo:

```bash
npx systwo demo
```

The demo must not require real provider credentials.

## 6. MCP Tool Surface

V0 should keep the public MCP surface small:

```text
route_task
delegate_task
usage_report
```

Task-specific behaviors should be represented as presets rather than permanent top-level tools.

Presets:

```text
summarize_codebase
draft_changes
fix_failures
```

This avoids an open-ended public API of verbs such as `add_tests`, `refactor`, `migrate`, `debug_logs`, and so on.

## 7. Tool Contracts

### 7.1 `route_task`

Purpose: return advice only.

It must not execute runner work.

Input:

```ts
type RouteTaskInput = {
  goal: string;
  contextSummary?: string;
  repoPath?: string;
  knownConstraints?: string[];
  desiredOutcome?: "advice" | "patch" | "test_fix" | "summary";
};
```

Output:

```ts
type RouteTaskOutput = {
  recommendedMode: "answer_directly" | "delegate" | "decline";
  recommendedPreset?: "summarize_codebase" | "draft_changes" | "fix_failures";
  recommendedProvider?: string;
  permissions: Permission[];
  risk: "low" | "medium" | "high";
  estimatedUsage: UsageEstimate;
  rationale: string;
  requiresExplicitControllerCall: boolean;
};
```

Hard rule:

```text
route_task cannot trigger delegate_task internally.
```

### 7.2 `delegate_task`

Purpose: delegate bounded execution to a provider.

Input:

```ts
type DelegateTaskInput = {
  brief: TaskBrief;
  provider?: string;
  preset?: "summarize_codebase" | "draft_changes" | "fix_failures";
  mode?: "temp_worktree" | "patch_only";
};
```

Output:

```ts
type DelegateTaskOutput = TaskResult;
```

Rules:

- The controller must call this explicitly.
- Edit-capable work must use `temp_worktree` or `patch_only`.
- Main worktree edits are forbidden in V0.
- `patch_only` skips provider-side file mutation and returns a patch proposal.

### 7.3 `usage_report`

Purpose: aggregate estimated and actual usage.

V0 requirements:

- Always support estimated usage.
- Record actual usage when the provider exposes it.
- Mark actual usage as unavailable when it cannot be collected.

## 8. Presets

### `summarize_codebase`

Purpose: broad read/search/context gathering.

Typical permissions:

```text
read
```

Optional permissions:

```text
command
```

Only for read-only commands such as `git status`, `rg`, `ls`, or test discovery.

### `draft_changes`

Purpose: produce a proposed patch.

Default mode:

```text
temp_worktree
```

Safe mode:

```text
patch_only
```

Required output:

- summary
- diff path
- changed files
- risk notes
- usage estimate

### `fix_failures`

Purpose: run a bounded fix-and-retry loop for failing tests, lint errors, or mechanical regressions.

Input must include at least one of:

- `testCommand`
- failing log summary
- explicit acceptance criteria

Required output:

- diff path
- test command
- test status
- test output summary or output path
- usage estimate
- actual usage when available

## 9. Permissions

V0 permission enum:

```ts
type Permission = "read" | "temp_edit" | "command" | "network";
```

Defaults:

```yaml
read: true
temp_edit: false
command: false
network: false
```

Network is disabled by default.

If network isolation cannot be technically enforced for a provider on a platform, SysTwo must report that limitation clearly.

## 10. Safety Floor

These rules cannot be weakened by user config, repo config, or per-call inputs in V0:

1. Runners must not edit the main worktree.
2. Runners must not commit, push, merge, tag, or release.
3. SysTwo must not expose `apply_result` in V0.
4. Network access is off by default.
5. Secrets must not be printed, copied, uploaded, or summarized into traces.
6. Destructive shell commands are blocked unless a future explicit policy allows them.
7. Edit-capable tools must return diff evidence.
8. Test-capable tools must return test evidence or explain why tests were not run.
9. Provider output must be treated as untrusted.

## 11. Configuration

Resolution order:

```text
hardcoded safety floor
  -> user config
  -> repo config
  -> per-call constraints
```

Later layers may narrow permissions or change routing preferences. They cannot weaken the safety floor.

User config:

```text
~/.config/systwo/config.yaml
```

Repo config:

```text
./systwo.yaml
```

Example:

```yaml
version: 1

routing:
  defaultProvider: mock
  preferCheapRunnersFor:
    - code_search
    - log_summary
    - test_retry
  requireExplicitControllerCallFor:
    - temp_edit
    - command
    - network

permissions:
  network: false
  command: ask
  edit: temp_worktree_only

worktrees:
  root: .systwo/worktrees
  cleanup: on_success
  maxConcurrent: 2

usage:
  estimateBeforeRun: true
  recordActualWhenAvailable: true
```

## 12. Provider Interface

V0 ships with:

```text
mock provider
CodeBuddy reference provider
```

Provider interface:

```ts
interface Provider {
  id: string;
  displayName: string;
  capabilities: ProviderCapability[];
  estimateUsage(input: TaskBrief): Promise<UsageEstimate>;
  runTask(input: TaskBrief, options: RunOptions): Promise<TaskResult>;
  doctor?(): Promise<ProviderDoctorResult>;
}
```

Capabilities:

```ts
type ProviderCapability =
  | "code_search"
  | "log_summary"
  | "draft_patch"
  | "test_retry"
  | "mechanical_fix";
```

Run options:

```ts
type RunOptions = {
  repoPath: string;
  worktreePath?: string;
  mode: "temp_worktree" | "patch_only";
  timeoutMs?: number;
  networkAllowed: boolean;
  traceId: string;
};
```

## 13. Task Brief

```ts
type TaskBrief = {
  goal: string;
  contextSummary: string;
  preset?: "summarize_codebase" | "draft_changes" | "fix_failures";
  allowedFiles?: string[];
  permissions: Permission[];
  acceptanceCriteria: string[];
  testCommand?: string;
  riskNotes?: string[];
};
```

Validation rules:

- `goal` must be concrete.
- `acceptanceCriteria` must be non-empty for edit-capable tasks.
- `testCommand` is required for `fix_failures` unless failing logs are provided.
- `network` requires explicit opt-in.
- `temp_edit` requires temporary-worktree mode.

## 14. Result Contract

```ts
type TaskResult = {
  status: "success" | "failed" | "needs_review";
  summary: string;
  provider: string;
  traceId: string;
  worktreePath?: string;
  diffPath?: string;
  inlinePatch?: string;
  changedFiles?: string[];
  testEvidence?: TestEvidence;
  usage: {
    estimated?: UsageEstimate;
    actual?: UsageActual;
  };
  riskNotes: string[];
};
```

Diff behavior:

- Always return `diffPath` for edit-capable tasks.
- Return `inlinePatch` only when the patch is small enough for the MCP client.
- Return a human-readable summary either way.

## 15. Usage Model

Usage estimate:

```ts
type UsageEstimate = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  confidence: "low" | "medium" | "high";
  basis: string;
};
```

Actual usage:

```ts
type UsageActual = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  source: "provider" | "runner_log" | "unavailable";
};
```

## 16. Worktree Lifecycle

Worktree management is part of the core product, not an implementation detail.

V0 must handle:

- creation
- naming
- trace association
- cleanup on success
- cleanup on failure according to config
- orphan detection
- dirty-state reporting
- concurrency limits
- disk usage warnings

Default behavior:

```text
create temp worktree
run provider inside temp worktree
capture diff and evidence
preserve failed worktree for inspection
clean up successful worktree when configured
```

## 17. Doctor Command

`systwo doctor` checks:

- Node.js version.
- SysTwo package version.
- MCP server startup.
- Git availability.
- Temporary worktree creation.
- Provider availability.
- Mock provider availability.
- Config validity.
- Network default status.
- Current repo status when relevant.
- Basic write permission for worktree root.

## 18. V0 Demo Acceptance Criteria

The zero-config demo must prove:

1. SysTwo can start as an MCP-capable server package.
2. `route_task` returns advice without executing.
3. `delegate_task` can run with the mock provider.
4. A temporary worktree is created.
5. The main worktree remains untouched.
6. A diff path is returned.
7. Test evidence is returned.
8. Estimated usage is returned.
9. Actual usage is marked unavailable or populated by the provider.
10. The final decision is left to the controller/human.

The reference CodeBuddy demo must additionally prove:

1. SysTwo can discover CodeBuddy.
2. CodeBuddy can run non-interactively.
3. CodeBuddy output can be converted into `TaskResult`.
4. Failure modes are reported clearly.

## 19. Repository Shape

Suggested open-source repo:

```text
README.md
LICENSE
SECURITY.md
CONTRIBUTING.md
package.json
src/
  cli/
  mcp/
  router/
  policy/
  usage/
  providers/
    mock/
    codebuddy/
  worktrees/
  traces/
docs/
  V0_SPEC.md
  THREAT_MODEL.md
  PROVIDER_ADAPTERS.md
  ROUTING_POLICY.md
examples/
  failing-test-demo/
tests/
  safety/
  providers/
  worktrees/
```

## 20. Competitive Position

SysTwo should be described as complementary to adjacent systems.

Agent frameworks such as LangGraph, AutoGen, Microsoft Agent Framework, and CrewAI help developers build agent systems. SysTwo is narrower: it is a drop-in MCP server for bounded coding delegation.

Model gateways such as OpenRouter, LiteLLM, Portkey, and Helicone route model/API requests. SysTwo routes task steps with permissions, worktrees, evidence, and usage.

Observability systems such as LangSmith and Helicone help trace, evaluate, and monitor AI behavior. SysTwo records delegation evidence, but its primary job is deciding and enforcing who should do which work.

Coding agents such as Claude Code, OpenCode, OpenHands, and Aider execute coding tasks. SysTwo orchestrates runner agents behind a controller instead of becoming another coding UI.

## 21. V0 Non-Goals

- General multi-agent chat.
- General research automation.
- Writing workflows.
- Browser automation.
- Hosted service.
- GitHub App behavior.
- Direct PR creation.
- Direct commits.
- Applying generated patches to the main worktree.
- Full provider marketplace.
- Enterprise policy server.

## 22. Open Questions

1. Should successful temp worktrees be cleaned immediately or retained for a short TTL?
2. Should traces be stored as JSONL files, SQLite, or both?
3. What is the exact CodeBuddy non-interactive command contract?
4. How much provider sandboxing can be enforced consistently on macOS, Linux, and Windows?
5. Should third-party provider adapters live in the main repo or separate packages?
6. Should third-party provider adapters follow the core repository license or use separate package-level licensing?
