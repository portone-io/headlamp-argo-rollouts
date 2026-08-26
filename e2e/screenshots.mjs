// Captures README screenshots by driving a live Headlamp (with this plugin
// loaded) against a kind cluster running a sample Rollout. Volatile content
// (the relative-age "Created" column) is hidden before capture, and a capture
// is written only when it differs from the committed image by at least one
// perceptible pixel, so only real UI changes produce a diff (and thus a PR).
//
// Prereqs (see run.sh): Headlamp serving at $HL_URL with the demo-canary Rollout
// Paused mid-canary. Run: `node screenshots.mjs`.
import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

// PNG output is not byte-reproducible: two runs of an unchanged UI differ by a
// few hundred bytes of font rasterization, which is enough for git to see a
// change and for the workflow to open a PR. Compare pixels instead.
async function writeIfChanged(path, buffer) {
  let committed;
  try {
    committed = PNG.sync.read(await readFile(path));
  } catch {
    await writeFile(path, buffer);
    console.log(`${path}: written (no committed image)`);
    return;
  }

  const captured = PNG.sync.read(buffer);
  if (captured.width !== committed.width || captured.height !== committed.height) {
    await writeFile(path, buffer);
    console.log(`${path}: written (${committed.width}x${committed.height} -> ${captured.width}x${captured.height})`);
    return;
  }

  const diff = pixelmatch(committed.data, captured.data, null, captured.width, captured.height, {
    threshold: 0.1,
  });
  if (diff === 0) {
    console.log(`${path}: unchanged`);
    return;
  }

  await writeFile(path, buffer);
  console.log(`${path}: written (${diff} pixels changed)`);
}

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
  await writeIfChanged(`${OUT_DIR}/rollback-dialog.png`, await dialog.screenshot());
  // Remove the stabilization styles so the (now-hidden) app is interactive again.
  await style.evaluate(el => el.remove());

  // Close the dialog.
  await page.getByRole('button', { name: 'Close' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 15_000 });

  // --- Rollout actions menu (progressive-delivery controls) ---
  await page.getByRole('button', { name: 'Rollout actions' }).click();
  const menu = page.locator('.MuiMenu-paper');
  await menu.getByText('Promote', { exact: true }).waitFor({ timeout: 15_000 });
  await writeIfChanged(`${OUT_DIR}/rollout-actions.png`, await menu.screenshot());

  await browser.close();
  console.log(`Screenshots up to date in ${OUT_DIR}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
