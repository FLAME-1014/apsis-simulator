import test from 'node:test';
import assert from 'node:assert/strict';
import { ImpactLab, RESTITUTION, driftAsteroids, makeBelt, resolveSphereImpact, rockAngularMomentum, rockEnergy, sphereImpactTime } from '../src/physics/asteroids.js';
import { norm } from '../src/physics/math.js';

function rock(id, position, velocity, radius = 1, mass = 1) {
  return { id, position, velocity, radius, mass, removed: false };
}

test('continuous collision detection catches a 400 km/s pass inside one frame', () => {
  assert.ok(Math.abs(sphereImpactTime([-10_000, 0, 0], [200, 0, 0], [10_000, 0, 0], [-200, 0, 0], 2, 100) - 49.995) < 1e-10);
});

test('a discriminant-free pass and a receding pair do not collide', () => {
  assert.equal(sphereImpactTime([-10, 0, 9], [20, 0, 0], [10, 0, 0], [-20, 0, 0], 2, 1), null);
  assert.equal(sphereImpactTime([-10, 0, 0], [-1, 0, 0], [10, 0, 0], [1, 0, 0], 2, 30), null);
});

test('touching spheres count a zero-time contact only when approaching', () => {
  assert.equal(sphereImpactTime([0, 0, 0], [1, 0, 0], [2, 0, 0], [-1, 0, 0], 2, 1), 0);
  assert.equal(sphereImpactTime([0, 0, 0], [-1, 0, 0], [2, 0, 0], [1, 0, 0], 2, 1), null);
});

test('penetrating spheres get an immediate correction even if already separating', () => {
  assert.equal(sphereImpactTime([0, 0, 0], [2, 0, 0], [1.5, 0, 0], [-2, 0, 0], 2, 1), 0);
  assert.equal(sphereImpactTime([0, 0, 0], [-1, 0, 0], [1.5, 0, 0], [1, 0, 0], 2, 1), 0);
  const a = rock('a', [0, 0, 0], [-1, 0, 0]);
  const b = rock('b', [1.5, 0, 0], [1, 0, 0]);
  const result = driftAsteroids([a, b], 1);
  assert.equal(result.limited, false);
  assert.deepEqual([a.velocity, b.velocity], [[-1, 0, 0], [1, 0, 0]]);
  assert.ok(norm(a.position.map((value, i) => value - b.position[i])) >= 2);
});

test('equal-mass head-on impact obeys Newtonian impulse and restitution', () => {
  const a = rock('a', [-1, 0, 0], [3, 0, 0]);
  const b = rock('b', [1, 0, 0], [-1, 0, 0]);
  resolveSphereImpact(a, b, 0.7);
  assert.ok(Math.abs(a.velocity[0] - (-0.4)) < 1e-12);
  assert.ok(Math.abs(b.velocity[0] - 2.4) < 1e-12);
  assert.ok(Math.abs(a.position[0] - b.position[0] + 2) < 1e-8);
});

test('perfectly elastic impacts reverse the relative normal speed', () => {
  const a = rock('a', [0, 0, 0], [8, 0, 0]);
  const b = rock('b', [2, 0, 0], [-3, 0, 0]);
  resolveSphereImpact(a, b, 1);
  assert.ok(Math.abs(b.velocity[0] - a.velocity[0] - 11) < 1e-12);
});

test('completely inelastic impacts equalize the velocity of equal masses', () => {
  const a = rock('a', [0, 0, 0], [8, 0, 0]);
  const b = rock('b', [2, 0, 0], [-3, 0, 0]);
  resolveSphereImpact(a, b, 0);
  assert.ok(Math.abs(a.velocity[0] - b.velocity[0]) < 1e-12);
  assert.ok(Math.abs(a.velocity[0] - 2.5) < 1e-12);
});

test('unequal-mass rebounds conserve momentum and dissipate exactly the expected energy', () => {
  const a = rock('a', [-1.4, 0, 0], [4, 2, 0], 1, 5);
  const b = rock('b', [1.4, 0, 0], [-1, -3, 0], 1, 2);
  const e0 = 0.5 * a.mass * norm(a.velocity) ** 2 + 0.5 * b.mass * norm(b.velocity) ** 2;
  const px = a.mass * a.velocity[0] + b.mass * b.velocity[0];
  const py = a.mass * a.velocity[1] + b.mass * b.velocity[1];
  const contact = resolveSphereImpact(a, b, 0.62);
  const e1 = 0.5 * a.mass * norm(a.velocity) ** 2 + 0.5 * b.mass * norm(b.velocity) ** 2;
  assert.ok(Math.abs(a.mass * a.velocity[0] + b.mass * b.velocity[0] - px) < 1e-12);
  assert.ok(Math.abs(a.mass * a.velocity[1] + b.mass * b.velocity[1] - py) < 1e-12);
  assert.ok(contact.impulse > 0 && e1 < e0);
  assert.ok(Math.abs(e0 - e1 - 0.5 * (1 - 0.62 ** 2) * contact.incomingNormalSpeed ** 2 / (1 / 5 + 1 / 2)) < 1e-12);
});

test('a glancing impulse produces the correct sideways redirection', () => {
  const x = Math.sqrt(1 - 0.3 ** 2);
  const a = rock('a', [-x, 0, 0.3], [1, 0, 0]);
  const b = rock('b', [x, 0, -0.3], [-0.8, 0, 0]);
  const angular = rockAngularMomentum([a, b]);
  const energy = rockEnergy([a, b]);
  resolveSphereImpact(a, b, 1);
  assert.ok(a.velocity[2] > 0.01 && b.velocity[2] < -0.01);
  const newAngular = rockAngularMomentum([a, b]);
  assert.ok(norm(newAngular.map((value, axis) => value - angular[axis])) < 1e-8);
  assert.ok(Math.abs(rockEnergy([a, b]) - energy) < 1e-12);
});

test('a static exact-center overlap chooses a finite deterministic contact normal', () => {
  const a = rock('a', [1, 2, 3], [0, 0, 0]);
  const b = rock('b', [1, 2, 3], [0, 0, 0]);
  const contact = resolveSphereImpact(a, b);
  assert.equal(contact.impulse, 0);
  assert.ok(contact.normal.every(Number.isFinite));
  assert.ok(Math.abs(norm(a.position.map((v, i) => v - b.position[i])) - 2) < 1e-9);
});

test('swept asteroid impacts cannot tunnel through each other', () => {
  const rocks = [rock('A', [-10, 0, 0], [300, 0, 0]), rock('B', [10, 0, 0], [-300, 0, 0])];
  const events = [];
  driftAsteroids(rocks, 1, { onImpact: (event) => events.push(event) });
  assert.equal(events.length, 1);
  assert.ok(Math.abs(events[0].time - 0.03) < 1e-12);
  assert.ok(norm(rocks[0].position.map((v, i) => v - rocks[1].position[i])) > 2);
  assert.ok(rocks[0].velocity[0] < 0 && rocks[1].velocity[0] > 0);
});

test('arbitrary swept steps consume all remaining time after an elastic rebound', () => {
  const rocks = [rock('A', [-5, 0, 0], [2, 0, 0]), rock('B', [5, 0, 0], [-3, 0, 0])];
  driftAsteroids(rocks, 4, { restitution: 1 });
  assert.ok(Math.abs(rocks[0].position[0] - (-9)) < 1e-8);
  assert.ok(Math.abs(rocks[1].position[0] - 5) < 1e-8);
});

test('time-of-impact contacts are processed in chronological order', () => {
  const rocks = [rock('A', [-10, 0, 0], [2, 0, 0]), rock('B', [0, 0, 0], [0, 0, 0]), rock('C', [12, 0, 0], [0, 0, 0])];
  const events = [];
  driftAsteroids(rocks, 12, { restitution: 1, onImpact: ({ a, b, time }) => events.push({ a, b, time }) });
  assert.deepEqual(events.map(({ a, b }) => `${a}${b}`), ['AB', 'BC']);
  assert.ok(events[0].time < events[1].time);
});

test('the chronological collision loop prevents a later body impact after earlier absorption', () => {
  const rockBody = rock('A', [10, 0, 0], [-4, 0, 0], 0.5, 1);
  const earlier = rock('inner', [2, 0, 0], [0, 0, 0], 1, 1);
  const later = rock('outer', [-5, 0, 0], [0, 0, 0], 1, 1);
  const events = [];
  driftAsteroids([rockBody], 5, { planets: [earlier, later], onImpact: (event) => events.push(event) });
  assert.equal(events.length, 1);
  assert.equal(events[0].b, 'inner');
  assert.equal(rockBody.removed, true);
});

test('a planet absorbs an impactor without applying a rebound to the artificial planet', () => {
  const asteroid = rock('dust', [-5, 0, 0], [10, 0, 0], 0.25, 1e9);
  const planet = rock('Mars', [0, 0, 0], [0, 0, 0], 2, 9e20);
  const events = [];
  driftAsteroids([asteroid], 1, { planets: [planet], onImpact: (event) => events.push(event) });
  assert.equal(asteroid.removed, true);
  assert.equal(planet.position[0], 0);
  assert.equal(events[0].absorbed, true);
  assert.equal(events[0].b, 'Mars');
});

test('generated belt is deterministically reproducible at the same seed', () => {
  const sun = { mu: 10, position: [0, 0, 0], velocity: [0, 0, 0] };
  const a = makeBelt(sun, 32);
  const b = makeBelt(sun, 32);
  assert.deepEqual(a, b);
});

test('every generated asteroid has positive mass, radius, and heliocentric distance', () => {
  const asteroids = makeBelt({ mu: 132_712_440_041.9394, position: [0, 0, 0], velocity: [0, 0, 0] }, 64);
  assert.equal(asteroids.length, 64);
  for (const body of asteroids) assert.ok(body.mass > 0 && body.radius > 0 && norm(body.position) > 2 * 149_597_870);
});

test('the head-on preset collides and follows a 0.62 restitution rebound', () => {
  const lab = new ImpactLab('direct');
  assert.equal(lab.restitution, RESTITUTION);
  while (lab.step(0.05));
  assert.equal(lab.events.length, 1);
  assert.ok(lab.events[0].time > 0);
  assert.ok(norm(lab.rocks[0].velocity.map((value, i) => value - lab.rocks[1].velocity[i])) > 0);
});

test('the glancing preset collides and gives both rocks transverse momentum', () => {
  const lab = new ImpactLab('grazing');
  while (lab.step(0.05));
  assert.equal(lab.events.length, 1);
  assert.notEqual(lab.rocks[0].velocity[2], 0);
  assert.notEqual(lab.rocks[1].velocity[2], 0);
});

test('the designed near miss remains separated', () => {
  const lab = new ImpactLab('miss');
  while (lab.step(0.05));
  assert.equal(lab.events.length, 0);
  assert.ok(norm(lab.rocks[0].position.map((value, i) => value - lab.rocks[1].position[i])) > 0.99);
});

test('an inelastic head-on experiment never gains kinetic energy', () => {
  const lab = new ImpactLab('direct');
  lab.restitution = 0;
  while (lab.step(0.05));
  assert.ok(rockEnergy(lab.rocks) <= lab.initialEnergy);
});
