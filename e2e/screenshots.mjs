// Captures README screenshots by driving a live Headlamp (with this plugin
// loaded) against a kind cluster running a sample Rollout. Volatile content
// (the relative-age "Created" column) is hidden before capture so the images
// are stable across runs — only real UI changes produce a diff (and thus a PR).
//
// Prereqs (see run.sh): Headlamp serving at $HL_URL with the demo-canary Rollout
// Paused mid-canary. Run: `node screenshots.mjs`.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HL_URL = process.env.HL_URL ?? 'http://localhost:4466';
const CLUSTER = process.env.CLUSTER ?? 'hl-verify';
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');

const detailUrl =
  `${HL_URL}/c/kind-${CLUSTER}/customresources/rollouts.argoproj.io/demo/demo-canary`;

// Stabilize the capture so only real UI changes move the pixels:
//  - hide the relative-time "Created" column (last cell per revision row),
//  - hide the app behind the modal (everything under <body> that isn't the
//    dialog's portal) so the volatile detail page can't show through, and
//  - drop the theme's translucent/blurred glass surface for a solid backdrop.
const STABILIZE_CSS = `
  body { background: rgb(15, 23, 42) !important; }
  body > *:not(.MuiModal-root):not(.MuiDialog-root) { visibility: hidden !important; }
  /* Re-show the dialog subtree in case it is nested under a hidden app root. */
  .MuiModal-root, .MuiDialog-root, .MuiDialog-root * { visibility: visible !important; }
  .MuiBackdrop-root { background-color: rgb(15, 23, 42) !important; }
  .MuiDialog-paper, .MuiDialog-paper .MuiPaper-root {
    background: rgb(26, 32, 44) !important;
    background-image: none !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
  .MuiDialog-paper table tr > *:last-child { visibility: hidden !important; }
`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1024, height: 840 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });

  await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 60_000 });

  // --- Rollback dialog: enriched revision history (roles, pods, AnalysisRuns) ---
  await page.getByRole('button', { name: 'Rollback' }).click();
  const dialog = page.locator('.MuiDialog-paper');
  await dialog.getByText('Rollback Rollout:').waitFor({ timeout: 30_000 });
  // Wait for the enriched rows to load (roles come from the RolloutInfo aggregation).
  await dialog.getByText('canary', { exact: true }).waitFor({ timeout: 30_000 });
  await dialog.getByText('stable', { exact: true }).waitFor({ timeout: 30_000 });
  const style = await page.addStyleTag({ content: STABILIZE_CSS });
  await dialog.screenshot({ path: `${OUT_DIR}/rollback-dialog.png` });
  // Remove the stabilization styles so the (now-hidden) app is interactive again.
  await style.evaluate(el => el.remove());

  // Close the dialog.
  await page.getByRole('button', { name: 'Close' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 15_000 });

  // --- Rollout actions menu (progressive-delivery controls) ---
  await page.getByRole('button', { name: 'Rollout actions' }).click();
  const menu = page.locator('.MuiMenu-paper');
  await menu.getByText('Promote', { exact: true }).waitFor({ timeout: 15_000 });
  await menu.screenshot({ path: `${OUT_DIR}/rollout-actions.png` });

  await browser.close();
  console.log(`Wrote screenshots to ${OUT_DIR}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
