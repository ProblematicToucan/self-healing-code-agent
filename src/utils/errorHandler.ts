import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ErrorReport } from '../schemas/errorReport';

const AGENT_CMD = 'agent';
const WORKSPACE_DIR = 'workspace';
const ERROR_CONTEXT_FILE = 'error-context.md';
const CLONE_TIMEOUT_MS = 60_000;

const STEP_PROMPTS = {
  install:
    'Install project dependencies (npm install, yarn, pnpm, uv sync, etc.) so the project is ready to run.',
  investigate:
    'Read error-context.md in this repo. Investigate the error and identify the cause.',
  fix: 'Using your investigation, fix the error. Apply code changes in this repo.',
  commitPushPr:
    'Create a new branch with a descriptive name related to the issue (e.g. fix/sqlite-connection-error, fix/timeout-handling). Commit your changes, push the branch, and open a pull request.',
} as const;

/** Derive a fs-safe slug from source URL/path (e.g. last path segment, sanitized). */
function sourceToSlug(source: string): string {
  try {
    const url = new URL(source);
    const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const last = segments[segments.length - 1] || 'repo';
    return last.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'repo';
  } catch {
    const sanitized = source.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return sanitized || 'repo';
  }
}

/** Resolve workspace root and clone dir: workspace/<slug>-<timestamp>. */
function getCloneDir(source: string): string {
  const workspaceRoot = path.join(process.cwd(), WORKSPACE_DIR);
  const slug = sourceToSlug(source);
  const timestamp = Date.now();
  return path.join(workspaceRoot, `${slug}-${timestamp}`);
}

/** Run git clone for the given branch. On failure (e.g. branch missing) log and return false. */
function cloneRepo(source: string, cloneDir: string, branch: string): boolean {
  mkdirSync(path.dirname(cloneDir), { recursive: true });
  const args = ['clone', '-b', branch.trim(), source, cloneDir];
  const r = spawnSync('git', args, {
    encoding: 'utf8',
    timeout: CLONE_TIMEOUT_MS,
  });
  if (r.status !== 0) {
    console.error('[pipeline] git clone failed:', r.stderr || r.stdout || r.error);
    return false;
  }
  return true;
}

const GITIGNORE_ENTRY = `\n# Self-healing pipeline (do not commit)\n${ERROR_CONTEXT_FILE}\n`;

/** Write error context file inside the clone and add to clone's .gitignore so it is not committed. */
function writeErrorContext(cloneDir: string, report: ErrorReport): void {
  const lines: string[] = [
    '# Error context',
    '',
    `**Message:** ${report.message}`,
    '',
    report.stack ? `**Stack:**\n\`\`\`\n${report.stack}\n\`\`\`` : '',
    report.timestamp ? `**Timestamp:** ${report.timestamp}` : '',
    report.metadata && Object.keys(report.metadata).length > 0
      ? `**Metadata:**\n\`\`\`json\n${JSON.stringify(report.metadata, null, 2)}\n\`\`\``
      : '',
  ].filter(Boolean);
  const filePath = path.join(cloneDir, ERROR_CONTEXT_FILE);
  writeFileSync(filePath, lines.join('\n'), 'utf8');

  const gitignorePath = path.join(cloneDir, '.gitignore');
  try {
    const existing = readFileSync(gitignorePath, 'utf8');
    if (!existing.includes(ERROR_CONTEXT_FILE)) {
      appendFileSync(gitignorePath, GITIGNORE_ENTRY, 'utf8');
    }
  } catch {
    // No .gitignore in clone; cleanupErrorContext before commit will remove the file so it is not committed
  }
}

/** Remove error context file from the clone before commit step so it is never included in the commit. */
function cleanupErrorContext(cloneDir: string): void {
  const filePath = path.join(cloneDir, ERROR_CONTEXT_FILE);
  try {
    unlinkSync(filePath);
  } catch {
    // Ignore if already missing
  }
}

/** Run one agent step; return true on success. */
function runAgentStep(cloneDir: string, step: keyof typeof STEP_PROMPTS): boolean {
  const prompt = STEP_PROMPTS[step];
  const r = spawnSync(AGENT_CMD, ['--model', 'auto', '-f', '-p', prompt], {
    cwd: cloneDir,
    stdio: 'inherit',
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    const detail =
      r.signal != null
        ? `killed by signal ${r.signal}`
        : r.error != null
          ? `spawn failed: ${r.error.message}`
          : `exit code ${r.status}`;
    console.error(`[pipeline] Agent step "${step}" failed: ${detail}`);
    return false;
  }
  return true;
}

/**
 * Run the self-healing pipeline: clone repo, write error context, then run agent steps
 * (install deps → investigate → fix → commit/push/PR) with cwd = clone.
 * Requires report.source and report.branch. Clones the given branch; if the branch does not exist, clone fails.
 * On any failure, log and reject so the job is marked failed; clone is left for debugging.
 */
export async function runPipeline(report: ErrorReport): Promise<void> {
  const source = report.source;
  if (!source?.trim()) {
    console.error('[pipeline] source is required');
    throw new Error('source is required');
  }

  const cloneDir = getCloneDir(source);
  if (!cloneRepo(source, cloneDir, report.branch)) {
    throw new Error(`git clone failed (branch "${report.branch}" may not exist)`);
  }

  writeErrorContext(cloneDir, report);

  const steps: (keyof typeof STEP_PROMPTS)[] = ['install', 'investigate', 'fix', 'commitPushPr'];
  for (const step of steps) {
    if (step === 'commitPushPr') {
      cleanupErrorContext(cloneDir);
    }
    if (!runAgentStep(cloneDir, step)) {
      throw new Error(`Pipeline step "${step}" failed`);
    }
  }
}

/** Log error, write error.log at project root, and optionally run a single agent from project root. Not used for pipeline (no clone). */
export function handleError(error: Error): void {
  console.error(error);
  const content = [error.message, error.stack].filter(Boolean).join('\n\n');
  writeFileSync(path.join(process.cwd(), 'error.log'), content);
  // No pipeline: no clone, no multi-step agent (middleware / callers without ErrorReport.source).
}
