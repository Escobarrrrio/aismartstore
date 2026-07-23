// Fails CI if "lovable" or "claude" show up anywhere they shouldn't -- keeps
// the repo from silently reaccumulating platform/assistant-name references
// (planning scratch files, doc comments, stale preview-domain URLs) the way
// it had before a manual cleanup pass found them.
//
// Two ways a real, necessary reference stays allowed:
//   1. ALLOWLISTED_FILES below -- for files where the reference is a genuine
//      functional dependency (an actual npm package, API key, or gateway URL
//      the app's real features run on), not attribution.
//   2. An inline `lovable-ref-ok` marker comment on the same line -- for a
//      one-off line in an otherwise-clean file (e.g. "claude" as a literal
//      AI-news keyword, unrelated to how the site was built).
//
// Everything else containing either word fails the check.

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(new URL(".", import.meta.url).pathname, "..");

const SCAN_EXTENSIONS = [".ts", ".tsx", ".md", ".json", ".html", ".toml", ".yml", ".yaml"];

const SKIP_DIRS = new Set([
  "node_modules", "dist", "dist-ssr", ".git", ".lovable", "coverage",
  "playwright-report", "test-results",
]);

const SKIP_FILES = new Set([
  "package-lock.json", "yarn.lock", "bun.lock", "pnpm-lock.yaml",
  "check-no-platform-refs.ts", // this file's own comments/strings above
]);

// Real functional dependencies on the hosting platform's auth-email,
// transactional-email, and AI-gateway APIs -- renaming these breaks actual
// features (password reset, order emails, AI chat fallback), not just hides
// a name. Verified during the 2026-07-23 cleanup pass.
const ALLOWLISTED_FILES = new Set([
  "supabase/functions/auth-email-hook/index.ts",
  "supabase/functions/process-email-queue/index.ts",
  "supabase/functions/_shared/ai-provider.ts",
]);

const SUPPRESSION_MARKER = "lovable-ref-ok";
const PATTERN = /lovable|claude/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (SCAN_EXTENSIONS.includes(entry.slice(entry.lastIndexOf(".")))) {
      if (!SKIP_FILES.has(entry)) out.push(full);
    }
  }
  return out;
}

const violations: { file: string; line: number; text: string }[] = [];

for (const absPath of walk(ROOT)) {
  const relPath = relative(ROOT, absPath).replace(/\\/g, "/");
  if (ALLOWLISTED_FILES.has(relPath)) continue;

  const lines = readFileSync(absPath, "utf-8").split("\n");
  lines.forEach((line, i) => {
    if (PATTERN.test(line) && !line.includes(SUPPRESSION_MARKER)) {
      violations.push({ file: relPath, line: i + 1, text: line.trim() });
    }
  });
}

if (violations.length > 0) {
  console.error(`\n✗ Found ${violations.length} reference(s) to "lovable" or "claude" outside the allowlist:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  console.error(
    `\nEither remove the reference, or if it's a genuine functional dependency,\n` +
    `add the file to ALLOWLISTED_FILES in scripts/check-no-platform-refs.ts\n` +
    `(with a comment explaining why), or add a "// ${SUPPRESSION_MARKER}" marker\n` +
    `to that specific line if it's a one-off exception in an otherwise-clean file.\n`
  );
  process.exit(1);
} else {
  console.log("✓ No stray lovable/claude references found.");
}
