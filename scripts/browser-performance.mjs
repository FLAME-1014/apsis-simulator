import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openBrowser, serveBuild } from './browser-harness.mjs';

const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });
const app = await serveBuild();
const browser = await openBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(app.url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.apsisDiagnostics && document.querySelector('#view-error').hidden);
  const report = {
    timestamp: new Date().toISOString(), viewport: '1440 × 900 CSS pixels; device scale 1',
    cpu: cpus()[0].model, os: `${platform()} ${release()}`, ramGB: Math.round(totalmem() / 1024 ** 3),
    gpu: await page.evaluate(() => window.apsisDiagnostics.renderer()),
    browser: `Chromium ${browser.version()} (headless; native hardware acceleration)`,
    workloads: [],
  };
  async function sample(label) {
    await page.waitForTimeout(900);
    await page.evaluate(() => window.apsisDiagnostics.resetFrameStats());
    await page.waitForFunction(() => window.apsisDiagnostics.frameStats().samples >= 290, null, { timeout: 22_000 });
    const measurements = await page.evaluate(() => ({ ...window.apsisDiagnostics.frameStats(),
      render: window.apsisDiagnostics.renderInfo() }));
    report.workloads.push({ label, ...measurements });
    console.log(label, JSON.stringify(measurements));
  }
  await sample('Observatory · 1 day/s');
  await page.locator('#time-rate').evaluate((input) => {
    input.value = input.max;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sample('Observatory · 60 days/s · 9 massive bodies + 44 integrated asteroids');
  await page.getByRole('button', { name: 'Asteroid lab', exact: true }).click();
  await page.locator('#time-rate').evaluate((input) => {
    input.value = '0';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Run experiment' }).click();
  await sample('Asteroid collision lab · 0.25×');
  await page.getByRole('button', { name: 'Mars mission', exact: true }).click();
  await page.getByRole('button', { name: 'Practice final descent' }).click();
  await page.getByRole('button', { name: 'Engage guidance' }).click();
  await page.waitForFunction(() => window.apsisDiagnostics.state().flight.altitude < 95);
  await sample('Mars descent · below 95 m · real shadows + terrain + 52 swept contact points');
  assert.equal(errors.length, 0, errors.join('\n'));
  for (const workload of report.workloads) {
    assert.ok(workload.fps >= 55, `${workload.label} averaged ${workload.fps.toFixed(1)} fps`);
    assert.ok(workload.p95Ms <= 22, `${workload.label} p95 frame interval ${workload.p95Ms.toFixed(2)} ms`);
  }
  await writeFile(new URL('performance.json', output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`PASS. Performance report: ${fileURLToPath(new URL('performance.json', output))}`);
  await page.close();
} finally {
  await browser.close();
  await app.close();
}
