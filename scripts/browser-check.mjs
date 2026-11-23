import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openBrowser, serveBuild } from './browser-harness.mjs';

const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });
const app = await serveBuild();
const browser = await openBrowser();
const problems = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(12_000);
  page.on('pageerror', (error) => problems.push(`Page: ${error.stack ?? error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('favicon')) problems.push(`Console: ${message.text().slice(0, 1100)}`);
  });
  page.on('requestfailed', (request) => problems.push(`Network: ${request.url()} ${request.failure()?.errorText}`));
  await page.goto(app.url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.apsisDiagnostics && document.querySelector('#view-error').hidden);
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.body-button').count(), 9);
  assert.match(await page.locator('#body-distance').textContent(), /1\.39\d AU/);
  assert.match(await page.evaluate(() => window.apsisDiagnostics.renderer()), /AMD|Radeon|ANGLE|SwiftShader/i);
  console.log('Observatory boot: PASS');

  await page.screenshot({ path: fileURLToPath(new URL('observatory.png', output)), animations: 'disabled' });
  await page.getByRole('button', { name: 'Pause simulation', exact: true }).click();
  const startTime = (await page.evaluate(() => window.apsisDiagnostics.state())).orbitTime;
  await page.getByRole('button', { name: 'Step simulation' }).click();
  assert.equal((await page.evaluate(() => window.apsisDiagnostics.state())).orbitTime, startTime + 3600);
  await page.getByRole('button', { name: 'Focus on Mars' }).click();
  assert.equal(await page.locator('#stage-title').textContent(), 'Mars');
  await page.screenshot({ path: fileURLToPath(new URL('mars-orbit.png', output)), animations: 'disabled' });
  await page.locator('.body-button').filter({ hasText: 'Earth' }).click();
  assert.match(await page.locator('#body-distance').textContent(), /0\.98\d AU/);

  await page.getByRole('button', { name: 'Asteroid lab', exact: true }).click();
  await page.waitForFunction(() => window.apsisDiagnostics.state().mode === 'impact');
  assert.equal(await page.getByRole('button', { name: 'Run experiment' }).isEnabled(), true);
  await page.locator('#restitution').evaluate((input) => {
    input.value = '0.20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await page.locator('#restitution-value').textContent(), '0.20');
  await page.getByRole('button', { name: 'Head-on' }).click();
  await page.locator('#time-rate').evaluate((input) => {
    input.value = input.max;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.screenshot({ path: fileURLToPath(new URL('asteroid-lab.png', output)), animations: 'disabled' });
  await page.getByRole('button', { name: 'Run experiment' }).click();
  await page.waitForFunction(() => window.apsisDiagnostics.state().impact.time >= 24.99, null, { timeout: 17_000 });
  const impact = (await page.evaluate(() => window.apsisDiagnostics.state())).impact;
  assert.equal(impact.collisions, 1);
  assert.ok(impact.energyRetained < 1);
  console.log('Orbit interaction and continuous asteroid impact: PASS');

  await page.getByRole('button', { name: 'Mars mission', exact: true }).click();
  await page.waitForFunction(() => window.apsisDiagnostics.state().mode === 'flight');
  await page.screenshot({ path: fileURLToPath(new URL('mars-approach.png', output)), animations: 'disabled' });
  await page.locator('#time-rate').evaluate((input) => {
    input.value = input.max;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Engage guidance' }).click();
  await page.waitForFunction(() => window.apsisDiagnostics.state().flight.status !== 'flying', null, { timeout: 58_000 });
  const approach = (await page.evaluate(() => window.apsisDiagnostics.state())).flight;
  assert.equal(approach.status, 'landed');
  assert.ok(approach.contact.range < 105);
  assert.ok(approach.contact.vertical <= 5);
  assert.ok(approach.contact.lateral <= 4);
  assert.ok(approach.fuel > 0);
  await page.screenshot({ path: fileURLToPath(new URL('mars-touchdown.png', output)), animations: 'disabled' });

  const stats = await page.evaluate(() => window.apsisDiagnostics.frameStats());
  console.log('Production browser: PASS');
  console.log('Renderer:', await page.evaluate(() => window.apsisDiagnostics.renderer()));
  console.log('Orbit selection and exact one-hour playback step: PASS');
  console.log('Restitution slider and whole head-on experiment:', impact, 'PASS');
  console.log('Guided inbound Mars landing:', { time: approach.time, status: approach.status,
    landingRange: approach.contact.range, verticalMps: approach.contact.vertical, lateralMps: approach.contact.lateral, fuel: approach.fuel }, 'PASS');
  console.log('Warm live rendering:', stats);
  console.log('Screenshots: artifacts/observatory.png, artifacts/mars-orbit.png, artifacts/asteroid-lab.png, artifacts/mars-approach.png, artifacts/mars-touchdown.png');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  mobile.setDefaultTimeout(12_000);
  mobile.on('pageerror', (error) => problems.push(`Mobile: ${error.stack ?? error.message}`));
  await mobile.goto(app.url, { waitUntil: 'networkidle' });
  await mobile.waitForFunction(() => window.apsisDiagnostics && document.querySelector('#view-error').hidden);
  await mobile.getByRole('button', { name: 'Mars mission', exact: true }).click();
  await mobile.getByRole('button', { name: 'Practice final descent' }).click();
  assert.ok(await mobile.locator('#touch-controls').isVisible());
  const thrust = mobile.locator('.touch-controls [data-thrust="Space"]');
  await mobile.locator('#start-flight').click();
  await thrust.hover();
  await mobile.mouse.down();
  await mobile.waitForTimeout(380);
  const mobileFlight = (await mobile.evaluate(() => window.apsisDiagnostics.state())).flight;
  assert.ok(mobileFlight.time > 0);
  assert.ok(mobileFlight.thrust > 0.9);
  await mobile.mouse.up();
  await mobile.waitForTimeout(100);
  assert.equal(await mobile.evaluate(() => window.apsisDiagnostics.state().flight.thrust), 0);
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await mobile.screenshot({ path: fileURLToPath(new URL('mobile-flight.png', output)), animations: 'disabled' });
  console.log('Touch controls and responsive 390px UI: PASS', mobileFlight);
  assert.equal(problems.length, 0, problems.join('\n'));
  await mobile.close();
  await page.close();
} catch (error) {
  if (problems.length) console.error(problems.join('\n'));
  throw error;
} finally {
  await browser.close();
  await app.close();
}
