import test from 'node:test';
import assert from 'node:assert/strict';
import { AU, DAY, PLANETS, YEAR } from '../src/physics/planets.js';
import { eccentricAnomaly, ellipsePoint, frameFromJpl, frameFromState, period, stateOnEllipse } from '../src/physics/orbits.js';
import { norm, sub } from '../src/physics/math.js';
import { initialSolarBodies, invariants, SolarSystem } from '../src/physics/solar-system.js';
import { inspectPlanet } from '../src/physics/telemetry.js';

const sunMu = PLANETS[0].mu;

for (const [eccentricity, mean] of [
  [0, 0], [0, 0.4], [0.0167, -2.7], [0.2056, 1.1], [0.8, 2.2], [0.94, -2.8], [0.999, 0.01], [0.999999, -1.4],
]) {
  test(`Kepler equation converges at e=${eccentricity}, M=${mean}`, () => {
    const eccentric = eccentricAnomaly(mean, eccentricity);
    const wrappedMean = ((mean + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    assert.ok(Math.abs(eccentric - eccentricity * Math.sin(eccentric) - wrappedMean) < 1e-12);
  });
}

test('Kepler solver rejects open, negative, and undefined eccentricity', () => {
  for (const e of [-0.1, 1, 1.2, NaN]) assert.throws(() => eccentricAnomaly(0, e), RangeError);
});

test('parabolic anomaly remains accurate immediately below the open-orbit boundary', () => {
  for (const mean of [-3.1, -0.6, 0.0002, 1.2, 3.1]) {
    const eccentric = eccentricAnomaly(mean, 1 - 1e-12);
    assert.ok(Math.abs(eccentric - (1 - 1e-12) * Math.sin(eccentric) - mean) < 5e-11);
  }
});

for (const [name, expected, tolerance] of [['Mercury', 0.2056, 0.001], ['Earth', 0.01671, 0.0001], ['Mars', 0.0934, 0.001]]) {
  test(`${name} JPL elements retain the reference eccentricity`, () => {
    const item = PLANETS.find(({ name: body }) => body === name);
    const frame = frameFromJpl(item.elements, sunMu);
    assert.ok(Math.abs(frame.e - expected) < tolerance);
  });
}

test('Earth J2000 orbital period agrees with one sidereal year', () => {
  const earth = PLANETS.find(({ id }) => id === 'earth');
  const frame = frameFromJpl(earth.elements, sunMu + earth.mu);
  assert.ok(Math.abs(period(frame.a, frame.mu) / YEAR - 1) < 0.002);
});

test('Earth J2000 position agrees with its published mean longitude', () => {
  const earth = PLANETS.find(({ id }) => id === 'earth');
  const state = stateOnEllipse(frameFromJpl(earth.elements, sunMu + earth.mu));
  assert.ok(Math.abs(norm(state.position) / AU - 0.9833) < 0.001);
  assert.ok(Math.abs(norm(state.velocity) - 30.286) < 0.035);
});

test('ellipse geometry obeys the semimajor, semiminor, and perihelion lengths', () => {
  const frame = { a: 5000, e: 0.35, p: [1, 0, 0], q: [0, 1, 0] };
  assert.ok(Math.abs(norm(ellipsePoint(frame, 0)) - 3250) < 1e-10);
  assert.ok(Math.abs(norm(ellipsePoint(frame, Math.PI)) - 6750) < 1e-10);
  assert.ok(Math.abs(ellipsePoint(frame, Math.PI / 2)[1] - 5000 * Math.sqrt(1 - 0.35 ** 2)) < 1e-10);
  assert.ok(Math.abs(norm(ellipsePoint(frame, Math.PI / 2)) - 5000) < 1e-10);
});

for (const [body, expectedAU, tolerance] of [['mercury', 0.466, 0.004], ['earth', 0.9833, 0.002], ['mars', 1.393, 0.003], ['neptune', 30.117, 0.01]]) {
  test(`${body} starts at its J2000 distance from the Sun`, () => {
    const index = PLANETS.findIndex(({ id }) => id === body);
    const telemetry = inspectPlanet(index, initialSolarBodies());
    assert.ok(Math.abs(telemetry.distanceAU - expectedAU) < tolerance, `${telemetry.distanceAU} AU`);
    assert.ok(telemetry.speedKmS > 0);
    assert.ok(telemetry.eccentricity > 0 && telemetry.eccentricity < 1);
  });
}

test('the initial barycentric frame has zero center of mass position and velocity', () => {
  const state = invariants(initialSolarBodies());
  assert.ok(norm(state.center) < 1e-3);
  assert.ok(norm(state.momentum) < 1e-14);
});

test('the Sun-centered initial state preserves relative J2000 orbital vectors', () => {
  const bodies = initialSolarBodies();
  const earth = bodies.find(({ id }) => id === 'earth');
  const sun = bodies[0];
  const reference = stateOnEllipse(frameFromJpl(PLANETS[3].elements, sunMu + PLANETS[3].mu));
  assert.ok(norm(sub(sub(earth.position, sun.position), reference.position)) < 1e-3);
  assert.ok(norm(sub(sub(earth.velocity, sun.velocity), reference.velocity)) < 1e-9);
});

test('a one-body Kepler ellipse recovered from state is round-trip accurate', () => {
  const expected = frameFromJpl(PLANETS[1].elements, sunMu + PLANETS[1].mu);
  for (const time of [0, -DAY, 13 * DAY, 284 * DAY]) {
    const reference = stateOnEllipse(expected, time);
    const recovered = frameFromState(reference.position, reference.velocity, expected.mu);
    const actual = stateOnEllipse(recovered, 0);
    assert.ok(norm(sub(actual.position, reference.position)) < 2e-3);
    assert.ok(norm(sub(actual.velocity, reference.velocity)) < 1e-8);
  }
});

test('open hyperbolic states correctly have no bound osculating ellipse', () => {
  assert.equal(frameFromState([1000, 0, 0], [0, 2, 0], 400), null);
});

test('all eight reference planetary element sets are elliptically bound', () => {
  const bodies = initialSolarBodies();
  for (let i = 1; i < bodies.length; i++) {
    const first = bodies[i];
    const frame = frameFromState(sub(first.position, bodies[0].position), sub(first.velocity, bodies[0].velocity), bodies[0].mu + first.mu);
    assert.ok(frame && frame.e < 0.25, `${first.id}: ${frame?.e}`);
  }
});

test('inspection displays a finite solar period label without inventing a bound solar orbit', () => {
  const result = inspectPlanet(0, initialSolarBodies());
  assert.equal(result.periodLabel, '—');
  assert.equal(result.eccentricity, null);
  assert.equal(result.distanceAU, 0);
});

test('the leapfrog trajectory converges as the Kepler step is refined', () => {
  const planet = PLANETS.find(({ id }) => id === 'earth');
  const mu = sunMu;
  const initial = stateOnEllipse(frameFromJpl(planet.elements, mu));
  const elapsed = 10 * DAY;
  const errors = [86_400, 21_600, 5400].map((step) => {
    const system = new SolarSystem([{ id: 'sun', mu: sunMu, position: [0, 0, 0], velocity: [0, 0, 0] },
      { id: 'earth', mu: 0, position: initial.position.slice(), velocity: initial.velocity.slice() }]);
    const count = elapsed / step;
    for (let i = 0; i < count; i++) system.step(step);
    return norm(sub(system.bodies[1].position, stateOnEllipse(frameFromJpl(planet.elements, mu), elapsed).position));
  });
  assert.ok(errors[1] < errors[0] * 0.11, errors.join(', '));
  assert.ok(errors[2] < errors[1] * 0.20, errors.join(', '));
});

test('the n-body force updates both members of a pair consistently', () => {
  const system = new SolarSystem([{ id: 'a', mu: 75, position: [-3, 0, 0], velocity: [0, 0, 0] },
    { id: 'b', mu: 12, position: [2, 0, 0], velocity: [0, 0, 0] }]);
  const [a, b] = system.accelerations;
  assert.ok(Math.abs(a[0] - 12 / 25) < 1e-12);
  assert.ok(Math.abs(b[0] + 75 / 25) < 1e-12);
  assert.ok(Math.abs(system.bodies[0].mu * a[0] + system.bodies[1].mu * b[0]) < 1e-12);
});

for (const [months, maxDrift] of [[1, 0.000001], [12, 0.000005], [120, 0.00004]]) {
  test(`the eight-body system conserves energy over ${months} simulation months`, () => {
    const system = new SolarSystem();
    const start = invariants(system.bodies).energy;
    for (let i = 0; i < Math.round(months * 30.4375 * DAY / 3600); i++) system.step();
    const end = invariants(system.bodies).energy;
    assert.ok(Math.abs((end - start) / start) < maxDrift, (end - start) / start);
  });
}

test('integrator retains positive orbital angular momentum', () => {
  const system = new SolarSystem();
  const start = norm(invariants(system.bodies).angularMomentum);
  for (let i = 0; i < 5000; i++) system.step();
  const end = norm(invariants(system.bodies).angularMomentum);
  assert.ok(start > 0 && Math.abs(end / start - 1) < 1e-8);
});
