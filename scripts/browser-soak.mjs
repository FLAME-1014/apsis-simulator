import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PLANETS, YEAR } from '../src/physics/planets.js';
import { frameFromState } from '../src/physics/orbits.js';
import { openBrowser, serveBuild } from './browser-harness.mjs';

const years = Number(process.argv[2] ?? 60);
if (!(years > 0 && years <= 120)) throw new RangeError('Choose 0–120 years of real-browser endurance playback.');
const app = await serveBuild();
const browser = await openBrowser();
const report = { startedAt: new Date().toISOString(), years, samples: [], errors: [] };
const output = new URL('../artifacts/', import.meta.url);
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => report.errors.push(error.stack));
  page.on('console', (message) => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(app.url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.apsisDiagnostics && document.querySelector('#view-error').hidden);
  await page.locator('#time-rate').evaluate((input) => {
    input.value = input.max;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const baseline = await page.evaluate(() => window.apsisDiagnostics.renderInfo());
  const start = performance.now();
  while (true) {
    await page.waitForTimeout(30_000);
    const sample = await page.evaluate(() => ({ state: window.apsisDiagnostics.state(),
      snapshot: window.apsisDiagnostics.snapshot(), stats: window.apsisDiagnostics.frameStats(),
      render: window.apsisDiagnostics.renderInfo() }));
    const elapsedYears = sample.state.orbitTime / YEAR;
    for (const [index, body] of sample.snapshot.bodies.entries()) {
      assert.ok([...body.positionKm, ...body.velocityKmS].every(Number.isFinite));
      if (index === 0) continue;
      const sun = sample.snapshot.bodies[0];
      const frame = frameFromState(body.positionKm.map((value, axis) => value - sun.positionKm[axis]),
        body.velocityKmS.map((value, axis) => value - sun.velocityKmS[axis]), PLANETS[0].mu + PLANETS[index].mu);
      assert.ok(frame && frame.e < 0.3, `${body.id} is no longer in its expected bound orbit`);
    }
    assert.equal(sample.render.geometries, baseline.geometries, 'GPU geometry count grew during playback');
    assert.equal(sample.render.textures, baseline.textures, 'GPU texture count grew during playback');
    assert.equal(report.errors.length, 0, report.errors.join('\n'));
    report.samples.push({ wallSeconds: (performance.now() - start) / 1000, elapsedYears,
      stats: sample.stats, gpuGeometryCount: sample.render.geometries, gpuTextureCount: sample.render.textures,
      integratedBeltImpacts: sample.state.beltImpacts });
    console.log(`Year ${elapsedYears.toFixed(2)} / ${years}; ${sample.stats.fps.toFixed(2)} fps; GPU resources ${sample.render.geometries} geometries / ${sample.render.textures} textures`);
    if (elapsedYears >= years) break;
    assert.ok(performance.now() - start < (years * 6.2 + 120) * 1000, 'Playback fell too far behind the requested time scale');
  }
  report.completedAt = new Date().toISOString();
  await page.close();
  console.log(`PASS: ${years} years of uninterrupted accelerated WebGL playback.`);
} finally {
  await mkdir(output, { recursive: true });
  await writeFile(new URL('ui-soak.json', output), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  await app.close();
}
