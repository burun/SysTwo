import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCommand } from "../core/shell.js";
import type { TaskBrief, TaskResult } from "../core/types.js";

export type BenchScore = {
  pass: boolean;
  reason: string;
};

export type BenchScenario = {
  id: string;
  title: string;
  mode: "temp_worktree" | "patch_only";
  brief: TaskBrief;
  /** Writes fixture files and creates the initial git commit. */
  setup(repoPath: string): Promise<void>;
  /** Objective scoring from delegation evidence only. */
  score(result: TaskResult): BenchScore;
};

async function initRepo(repoPath: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(repoPath, name), content);
  }
  await writeFile(join(repoPath, "package.json"), JSON.stringify({ type: "module" }, null, 2) + "\n");
  await writeFile(join(repoPath, ".gitignore"), ".systwo/\n");
  await runCommand("git", ["init"], { cwd: repoPath });
  await runCommand("git", ["add", "."], { cwd: repoPath });
  await runCommand(
    "git",
    ["-c", "user.name=SysTwo Bench", "-c", "user.email=bench@systwo.local", "commit", "-m", "bench fixture"],
    { cwd: repoPath }
  );
}

export function scoreEditScenario(result: TaskResult, allowedFiles: string[]): BenchScore {
  if (result.status === "failed") {
    return { pass: false, reason: `delegation failed: ${firstLine(result.summary)}` };
  }
  if (result.testEvidence?.status !== "passed") {
    return { pass: false, reason: `tests ${result.testEvidence?.status ?? "missing"}` };
  }
  const changed = result.changedFiles ?? [];
  if (changed.length === 0) {
    return { pass: false, reason: "no diff evidence" };
  }
  const outside = changed.filter((file) => !allowedFiles.includes(file));
  if (outside.length > 0) {
    return { pass: false, reason: `edits outside allowedFiles: ${outside.join(", ")}` };
  }
  return { pass: true, reason: "tests passed with bounded diff" };
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  return line.length > 120 ? `${line.slice(0, 120)}...` : line;
}

const singleFileFix: BenchScenario = {
  id: "single-file-mechanical-fix",
  title: "Single-file mechanical fix",
  mode: "temp_worktree",
  brief: {
    goal: "Fix the failing add function test in this repository.",
    contextSummary: "node test.js fails: add(2, 3) returns -1 instead of 5.",
    preset: "fix_failures",
    allowedFiles: ["math.js"],
    permissions: ["read", "temp_edit", "command"],
    acceptanceCriteria: ["node test.js passes", "Diff limited to math.js"],
    testCommand: "node test.js",
    riskNotes: []
  },
  async setup(repoPath) {
    await initRepo(repoPath, {
      "math.js": ["export function add(a, b) {", "  return a - b;", "}", ""].join("\n"),
      "test.js": [
        "import { strict as assert } from 'node:assert';",
        "import { add } from './math.js';",
        "assert.equal(add(2, 3), 5);",
        "assert.equal(add(-1, 1), 0);",
        "console.log('ok');",
        ""
      ].join("\n")
    });
  },
  score(result) {
    return scoreEditScenario(result, ["math.js"]);
  }
};

const crossFileFix: BenchScenario = {
  id: "cross-file-logic-fix",
  title: "Cross-file logic fix (three bugs)",
  mode: "temp_worktree",
  brief: {
    goal: "Fix all failing assertions in test.js. The bugs are in the pricing/cart logic, not in the tests.",
    contextSummary:
      "node test.js fails. subtotal ignores item.qty; discount and tax math are also wrong. Tests define the semantics: applyDiscount treats discountPercent as a percentage, taxAmount returns only the tax portion.",
    preset: "fix_failures",
    allowedFiles: ["cart.js", "pricing.js"],
    permissions: ["read", "temp_edit", "command"],
    acceptanceCriteria: ["node test.js passes", "Diff limited to cart.js and pricing.js", "Do not modify test.js"],
    testCommand: "node test.js",
    riskNotes: []
  },
  async setup(repoPath) {
    await initRepo(repoPath, {
      "pricing.js": [
        "export function applyDiscount(amount, discountPercent) {",
        "  if (discountPercent < 0 || discountPercent > 100) {",
        "    throw new RangeError('discountPercent must be between 0 and 100');",
        "  }",
        "  return amount - (amount * discountPercent) / 10;",
        "}",
        "",
        "export function taxAmount(amount, taxRate) {",
        "  return amount * (1 + taxRate / 100);",
        "}",
        ""
      ].join("\n"),
      "cart.js": [
        "import { applyDiscount, taxAmount } from './pricing.js';",
        "",
        "function round2(value) {",
        "  return Math.round(value * 100) / 100;",
        "}",
        "",
        "export function subtotal(items) {",
        "  return items.reduce((sum, item) => sum + item.price, 0);",
        "}",
        "",
        "export function cartTotal(items, opts = {}) {",
        "  const { discountPercent = 0, taxRate = 0 } = opts;",
        "  const discounted = applyDiscount(subtotal(items), discountPercent);",
        "  return round2(discounted + taxAmount(discounted, taxRate));",
        "}",
        ""
      ].join("\n"),
      "test.js": [
        "import { strict as assert } from 'node:assert';",
        "import { subtotal, cartTotal } from './cart.js';",
        "import { applyDiscount, taxAmount } from './pricing.js';",
        "assert.equal(subtotal([{ price: 10, qty: 3 }]), 30);",
        "assert.equal(subtotal([]), 0);",
        "assert.equal(applyDiscount(100, 25), 75);",
        "assert.equal(taxAmount(100, 8.25), 8.25);",
        "assert.equal(cartTotal([{ price: 10, qty: 3 }], { discountPercent: 10, taxRate: 10 }), 29.7);",
        "assert.equal(cartTotal([], {}), 0);",
        "console.log('ok');",
        ""
      ].join("\n")
    });
  },
  score(result) {
    return scoreEditScenario(result, ["cart.js", "pricing.js"]);
  }
};

const patchDraft: BenchScenario = {
  id: "patch-draft-receipt",
  title: "Patch-only feature draft",
  mode: "patch_only",
  brief: {
    goal: "Draft a formatReceipt(items, opts) function for cart.js that returns a plain-text receipt with one line per item plus subtotal, discount, tax, and total lines.",
    contextSummary: "cart.js exports subtotal and cartTotal; pricing.js exports applyDiscount and taxAmount. Items look like { name, price, qty }.",
    preset: "draft_changes",
    allowedFiles: ["cart.js", "pricing.js"],
    permissions: ["read"],
    acceptanceCriteria: [
      "Return a patch proposal only",
      "Reuse existing subtotal/applyDiscount/taxAmount, do not duplicate math",
      "No changes outside cart.js"
    ],
    riskNotes: []
  },
  async setup(repoPath) {
    await initRepo(repoPath, {
      "pricing.js": [
        "export function applyDiscount(amount, discountPercent) {",
        "  return amount - (amount * discountPercent) / 100;",
        "}",
        "",
        "export function taxAmount(amount, taxRate) {",
        "  return amount * (taxRate / 100);",
        "}",
        ""
      ].join("\n"),
      "cart.js": [
        "import { applyDiscount, taxAmount } from './pricing.js';",
        "",
        "function round2(value) {",
        "  return Math.round(value * 100) / 100;",
        "}",
        "",
        "export function subtotal(items) {",
        "  return items.reduce((sum, item) => sum + item.price * item.qty, 0);",
        "}",
        "",
        "export function cartTotal(items, opts = {}) {",
        "  const { discountPercent = 0, taxRate = 0 } = opts;",
        "  const discounted = applyDiscount(subtotal(items), discountPercent);",
        "  return round2(discounted + taxAmount(discounted, taxRate));",
        "}",
        ""
      ].join("\n")
    });
  },
  score(result) {
    // Weaker, presence-based signal for patch drafts in v1; see docs/BENCHMARKS.md.
    if (result.status === "failed") {
      return { pass: false, reason: `delegation failed: ${firstLine(result.summary)}` };
    }
    const patch = result.inlinePatch ?? "";
    if (!patch.trim()) {
      return { pass: false, reason: "no patch proposal" };
    }
    // Require an actual definition, not a goal echo: a function declaration or an added diff line.
    if (!/export function formatReceipt|^\+.*formatReceipt/m.test(patch)) {
      return { pass: false, reason: "patch does not define formatReceipt" };
    }
    if ((result.changedFiles ?? []).length > 0) {
      return { pass: false, reason: "patch_only run mutated files" };
    }
    return { pass: true, reason: "patch proposal defines formatReceipt without mutating files" };
  }
};

export const benchScenarios: BenchScenario[] = [singleFileFix, crossFileFix, patchDraft];

export function resolveScenarios(spec: string): BenchScenario[] {
  if (!spec || spec === "all") {
    return benchScenarios;
  }
  const ids = spec.split(",").map((item) => item.trim()).filter(Boolean);
  return ids.map((id) => {
    const scenario = benchScenarios.find((candidate) => candidate.id === id);
    if (!scenario) {
      throw new Error(`Unknown bench scenario "${id}". Available: ${benchScenarios.map((item) => item.id).join(", ")}`);
    }
    return scenario;
  });
}
