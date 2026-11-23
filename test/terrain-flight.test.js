import test from 'node:test';
import assert from 'node:assert/strict';
import { norm, random } from '../src/physics/math.js';
import { MARS } from '../src/physics/planets.js';
import { CONTACT_POINTS, FLIGHT_STEP, GEAR_Y, LANDER, MarsFlight, allowedFlightRate, descentGuidance, flightClearance, landingCheck, marsGravity, phaseForAltitude, sweepLander } from '../src/physics/flight.js';
import { LEVEL_LIMIT, MARS_RADIUS, PAD_RADIUS, TERRAIN_LEVELS, noise2, sweepTerrain, terrainCell, terrainHeight, terrainNormal, terrainRelief, terrainVertex } from '../src/physics/terrain.js';

test('Mars uses the named body’s physical radius in metres', () => {
  assert.equal(MARS_RADIUS, MARS.radius * 1000);
});

test('terrain relief is deterministic for an exact planetary coordinate', () => {
  for (const [x, z] of [[0, 0], [532, -782], [22_180, 1722], [-74_100, 41_000]]) {
    assert.equal(terrainRelief(x, z), terrainRelief(x, z));
    assert.equal(terrainHeight(x, z), terrainHeight(x, z));
  }
});

test('terrain coordinate noise is continuous and bounded', () => {
  for (const offset of [-201.4, -16.8, 0, 0.031, 71.1, 105.7]) {
    const a = noise2(193.25 + offset, -41.32, 23);
    const b = noise2(193.25 + offset, -41.32, 23);
    assert.equal(a, b);
    assert.ok(a >= -1 && a <= 1);
  }
  assert.ok(Math.abs(terrainRelief(102.1, 87.3) - terrainRelief(102.2, 87.3)) < 3);
});

test('generated surface uses the full concentric terrain hierarchy', () => {
  assert.deepEqual(TERRAIN_LEVELS.map(({ step }) => step), [4, 16, 64, 256, 1024, 4096, 16384]);
  assert.equal(TERRAIN_LEVELS.at(-1).extent, LEVEL_LIMIT);
  assert.equal(terrainCell(0, 0).step, 4);
  for (const { extent, step } of TERRAIN_LEVELS) {
    assert.equal(extent % step, 0);
    assert.ok(Number.isFinite(terrainVertex(0, extent, extent)));
    assert.ok(Number.isFinite(terrainVertex(TERRAIN_LEVELS.length - 1, -extent, -extent)));
  }
});

test('the landing site and inner terrain relief are level enough for safe practice', () => {
  const center = terrainHeight(0, 0);
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    assert.ok(Math.abs(terrainHeight(Math.cos(angle) * PAD_RADIUS, Math.sin(angle) * PAD_RADIUS) - center) < 7);
  }
});

test('LOD tile transitions select a more detailed cell towards the touchdown point', () => {
  assert.equal(terrainCell(3, -6).step, 4);
  assert.equal(terrainCell(700, 0).step, 16);
  assert.equal(terrainCell(1700, 0).step, 64);
  assert.equal(terrainCell(10_000, 0).step, 256);
  assert.equal(terrainCell(80_000, 0).step, 4096);
});

test('neighboring terrain tiles share identical linearly interpolated borders', () => {
  for (let level = 0; level < TERRAIN_LEVELS.length - 1; level++) {
    const extent = TERRAIN_LEVELS[level].extent;
    const fine = TERRAIN_LEVELS[level].step;
    const coarse = TERRAIN_LEVELS[level + 1].step;
    for (const sign of [-1, 1]) {
      for (let position = -extent + fine; position < extent; position += coarse / 3) {
        const snapped = terrainVertex(level, sign * extent, position);
        const t = ((position % coarse) + coarse) % coarse;
        const start = position - t;
        const a = terrainVertex(level + 1, sign * extent, start);
        const b = terrainVertex(level + 1, sign * extent, start + coarse);
        assert.ok(Math.abs(snapped - (a + (b - a) * t / coarse)) < 1e-9);
      }
    }
  }
});

test('contact normals are unit vectors pointing outward', () => {
  const rng = random(99211);
  for (let i = 0; i < 40; i++) {
    const x = (rng() - 0.5) * 5000;
    const z = (rng() - 0.5) * 5000;
    const normal = terrainNormal(x, z);
    assert.ok(Math.abs(norm(normal) - 1) < 1e-12);
    assert.ok(normal[1] >= 0);
  }
});

test('a stationary point above the terrain does not report a false landing', () => {
  const ground = terrainHeight(0, 0);
  assert.equal(sweepTerrain([0, ground + 50, 0], [0, ground + 50, 0]), null);
});

test('a fast vertical sweep returns its first exact ground-triangle contact', () => {
  const ground = terrainHeight(0, 0);
  const result = sweepTerrain([0, ground + 480, 0], [0, ground - 390, 0]);
  assert.ok(result);
  assert.ok(result.fraction > 0 && result.fraction < 1);
  assert.ok(Math.abs(result.point[1] - terrainHeight(0, 0)) < 1e-8);
  assert.ok(result.normal[1] > 0.999);
});

test('a fast oblique sweep does not pass between collidable terrain triangles', () => {
  const start = [-96, 44_000, -75];
  const end = [326, -4_000, 229];
  const result = sweepTerrain(start, end);
  assert.ok(result);
  assert.ok(result.fraction > 0 && result.fraction < 1);
  const clearance = result.point[1] - terrainHeight(result.point[0], result.point[2]);
  assert.ok(Math.abs(clearance) < 0.001);
});

test('the exact-cell sweep returns the first of two altitude crossings', () => {
  const start = [-1200, 3000, 75];
  const end = [1400, -3800, 600];
  const result = sweepTerrain(start, end);
  assert.ok(result);
  const ground = terrainHeight(result.point[0], result.point[2]);
  assert.ok(Math.abs(result.point[1] - ground) < 0.01);
  const sample = [Math.floor(result.fraction * 80), Math.ceil(result.fraction * 80)].filter((i) => i <= 80);
  assert.ok(sample.some((i) => start[1] + (end[1] - start[1]) * (i / 80) <= terrainHeight(
    start[0] + (end[0] - start[0]) * (i / 80), start[2] + (end[2] - start[2]) * (i / 80)) + 110));
});

test('the mission collision sweep checks all three landing struts', () => {
  const start = [0, terrainHeight(0, 0) + GEAR_Y + 100, 0];
  const end = [0, start[1] - 160, 0];
  const hit = sweepLander(start, end);
  assert.ok(hit);
  assert.ok(CONTACT_POINTS.includes(hit.foot));
  assert.ok(Math.abs(hit.point[1] - terrainHeight(hit.point[0], hit.point[2])) < 1e-8);
});

test('Mars gravity points downward and reproduces the surface acceleration', () => {
  const gravity = marsGravity([0, 0, 0]);
  const surface = MARS.mu * 1000 / MARS.radius ** 2;
  assert.ok(gravity[1] < 0 && Math.abs(gravity[1] + surface) < 1e-11);
  assert.ok(Math.abs(gravity[0]) < 1e-15);
  assert.ok(Math.abs(gravity[2]) < 1e-15);
});

test('Mars gravity follows an inverse-square field away from the surface', () => {
  const surface = Math.abs(marsGravity([0, 0, 0])[1]);
  for (const altitude of [300, 1800, 32_000, 140_000, 1_000_000]) {
    const higher = Math.abs(marsGravity([0, altitude, 0])[1]);
    assert.ok(higher < surface);
    const radiusRatio = (MARS_RADIUS + altitude) / MARS_RADIUS;
    assert.ok(Math.abs(higher / surface - 1 / radiusRatio ** 2) < 1e-12);
  }
});

test('attitude-independent landing telemetry rejects excessive vertical speed', () => {
  const result = landingCheck([0, 0, 0], [0, 20, 0], [0, 1, 0]);
  assert.equal(result.status, 'crashed');
  assert.equal(result.vertical, 20);
});

test('touchdown telemetry rejects excessive lateral speed', () => {
  const result = landingCheck([0, 0, 0], [4.9, -0.1, 0], [0, 1, 0]);
  assert.equal(result.safe, false);
  assert.equal(result.status, 'crashed');
});

test('touchdown telemetry rejects slopes steeper than the gear-safe limit', () => {
  const slope = 19 * Math.PI / 180;
  const result = landingCheck([0, 0, 0], [0, 0, 0], [Math.sin(slope), Math.cos(slope), 0]);
  assert.equal(result.status, 'crashed');
  assert.ok(Math.abs(result.slope - 19) < 1e-12);
});

test('a touchdown within the pad is judged at the exact contact point', () => {
  const result = landingCheck([PAD_RADIUS - 2, 0, 0], [0, -1, 0], [0, 1, 0]);
  assert.equal(result.status, 'landed');
  assert.equal(result.safe, true);
});

test('a safe touchdown outside the landing pad has its own result', () => {
  const result = landingCheck([PAD_RADIUS + 2, 0, 0], [0, -1, 0], [0, 1, 0]);
  assert.equal(result.status, 'off-pad');
  assert.equal(result.safe, true);
});

test('entry, braking, descent, and flare phases use their documented altitude bands', () => {
  assert.equal(phaseForAltitude(106_000), 'approach');
  assert.equal(phaseForAltitude(12_000), 'braking');
  assert.equal(phaseForAltitude(800), 'descent');
  assert.equal(phaseForAltitude(149), 'final');
});

test('maximum acceptable time compression decreases as terrain approaches', () => {
  assert.equal(allowedFlightRate(10_000), 8);
  assert.equal(allowedFlightRate(1800), 4);
  assert.equal(allowedFlightRate(500), 2);
  assert.equal(allowedFlightRate(60), 1);
});

test('descent guidance keeps total RCS acceleration inside the shared engine budget', () => {
  for (const altitude of [106_000, 12_000, 800, 90, 8]) {
    const position = [-52_000, MARS_RADIUS * altitude / MARS_RADIUS + terrainHeight(-52_000, 14_000), 14_000];
    const command = descentGuidance(position, [462, -920, 124], altitude, marsGravity(position), 32);
    assert.ok(norm(command) <= Math.sqrt(32 ** 2 + LANDER.lateralAcceleration ** 2) + 1e-9);
    assert.ok(command[1] >= 0);
    assert.ok(Math.hypot(command[0], command[2]) <= LANDER.lateralAcceleration + 1e-10);
  }
});

test('empty propellant never invents a throttle response', () => {
  const lander = new MarsFlight('practice');
  lander.fuel = 0;
  lander.guidance = true;
  lander.step(FLIGHT_STEP);
  assert.equal(lander.fuel, 0);
  assert.equal(lander.throttle, 0);
});

test('one approach frame uses fixed one-sixtieth-second dynamics', () => {
  const lander = new MarsFlight('approach');
  const start = lander.time;
  lander.step(FLIGHT_STEP);
  assert.ok(Math.abs(lander.time - start - FLIGHT_STEP) < 1e-12);
});

test('the practice checkpoint starts above the landing surface with nonzero speed', () => {
  const lander = new MarsFlight('practice');
  assert.equal(lander.status, 'flying');
  assert.ok(lander.altitude > 200 && lander.altitude < 280);
  assert.ok(norm(lander.velocity) > 8);
});

for (const checkpoint of ['practice', 'approach']) {
  test(`autonomous ${checkpoint} descent reaches the landing zone without terrain clipping`, () => {
    const lander = new MarsFlight(checkpoint);
    lander.guidance = true;
    let lastClearance = flightClearance(lander.position);
    for (let i = 0; i < 60 * 480 && lander.status === 'flying'; i++) {
      lander.step(FLIGHT_STEP);
      if (lander.status === 'flying') {
        const clearance = flightClearance(lander.position);
        assert.ok(clearance >= -1e-7, `${checkpoint} frame ${i}: ${clearance}`);
        assert.ok(lander.fuel >= 0);
        lastClearance = clearance;
      }
    }
    assert.equal(lander.status, 'landed', `last clearance: ${lastClearance}`);
    assert.ok(lander.contact.safe);
    assert.ok(lander.contact.range < PAD_RADIUS);
    assert.ok(lander.contact.vertical <= LANDER.verticalLimit);
    assert.ok(lander.contact.lateral <= LANDER.lateralLimit);
    assert.ok(lander.fuel > 0);
    assert.ok(flightClearance(lander.position) >= -1e-7);
  });
}

test('an unpiloted, engines-off final approach rejects unsafe impact', () => {
  const lander = new MarsFlight('practice');
  for (let i = 0; i < 80 * 60 && lander.status === 'flying'; i++) lander.step(FLIGHT_STEP);
  assert.notEqual(lander.status, 'landed');
  assert.ok(lander.contact?.vertical > LANDER.verticalLimit);
});
