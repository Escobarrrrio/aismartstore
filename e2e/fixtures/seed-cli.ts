/**
 * CLI wrapper for the deterministic E2E seed. Invoked by CI before
 * `playwright test` and available locally via `npm run test:e2e:seed`.
 *
 * Exit codes:
 *   0 — seed applied OR intentionally skipped (missing env vars)
 *   1 — seed attempted but failed (surface as CI failure)
 */

import { runSeed } from "./seed";

runSeed()
  .then((result) => {
    if (result.skipped) {
      console.warn(`[e2e seed] SKIPPED: ${result.reason}`);
      return;
    }
    console.log(
      `[e2e seed] OK — ${result.categories} categories, ${result.products} products upserted.`,
    );
  })
  .catch((err) => {
    console.error("[e2e seed] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
