import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedClock } from '../src/physics/clock.js';
import { DAY } from '../src/physics/planets.js';
import { ORBIT_STEP, SolarTimeline } from '../src/physics/solar-system.js';
import { stateOnEllipse, frameFromJpl } from '../src/physics/orbits.js';
import { PLANETS } from '../src/physics/planets.js';
import { norm } from '../src/physics/math.js';

test('a physics clock yields the same fixed steps at 30, 60, and 144 rendered frames per second', () => {
  for (const fps of [30, 60, 144]) {
    const clock = new FixedClock(1 / 60, 8);
    const calls = [];
    for (let frame = 0; frame < fps; frame++) clock.advance(1 / fps, (dt) => calls.push(dt));
    assert.equal(calls.length, 60);
    assert.ok(calls.every((dt) => dt === 1 / 60));
    assert.ok(clock.remainder < 1e-12);
  }
});

test('a frame work limit defers excess fixed steps without enlarging dt', () => {
  const clock = new FixedClock(0.1, 3);
  const calls = [];
  assert.equal(clock.advance(1, (dt) => calls.push(dt)), 3);
  assert.equal(clock.limited, true);
  while (clock.remainder >= 0.1 - 1e-12) clock.advance(0, (dt) => calls.push(dt));
  assert.equal(calls.length, 10);
  assert.deepEqual(new Set(calls), new Set([0.1]));
});

test('a terminal step stops the accumulator and drops terminal-step backlog', () => {
  const clock = new FixedClock(0.1, 10);
  let calls = 0;
  assert.equal(clock.advance(0.8, () => ++calls < 2), 2);
  assert.equal(calls, 2);
  assert.equal(clock.remainder, 0);
});

test('no elapsed time produces no new solar integration or visible change', () => {
  const timeline = new SolarTimeline();
  const state = structuredClone(timeline.read());
  assert.equal(timeline.advance(0), 0);
  assert.deepEqual(timeline.read(), state);
  assert.equal(timeline.time, 0);
});

test('solar sampling at the reference epoch exactly matches the initial numerical state', () => {
  const timeline = new SolarTimeline();
  assert.deepEqual(timeline.read(), timeline.system.bodies);
});

test('solar Hermite interpolation meets both positions and derivatives at a step boundary', () => {
  const timeline = new SolarTimeline();
  timeline.advance(ORBIT_STEP);
  const sample = timeline.read();
  for (let index = 0; index < sample.length; index++) {
    for (let axis = 0; axis < 3; axis++) {
      assert.equal(sample[index].position[axis], timeline.system.bodies[index].position[axis]);
      assert.equal(sample[index].velocity[axis], timeline.system.bodies[index].velocity[axis]);
    }
  }
});

test('substep solar position interpolation agrees with an independent short Kepler solution', () => {
  const timeline = new SolarTimeline();
  timeline.advance(1200);
  const sample = timeline.read();
  const mercury = sample[1];
  const exact = stateOnEllipse(frameFromJpl(PLANETS[1].elements, PLANETS[0].mu + PLANETS[1].mu), 1200);
  const relative = mercury.position.map((value, axis) => value - sample[0].position[axis]);
  assert.ok(norm(relative.map((value, axis) => value - exact.position[axis])) < 0.25);
});

test('a day of solar time is independent of the rendering frame partition', () => {
  const first = new SolarTimeline();
  const second = new SolarTimeline();
  first.advance(DAY);
  for (let i = 0; i < 240; i++) second.advance(DAY / 240);
  assert.equal(first.time, second.time);
  assert.deepEqual(first.read(), second.read());
});

test('the solar integration budget caps visible time rather than inventing a larger physics step', () => {
  const timeline = new SolarTimeline();
  const steps = [];
  const count = timeline.advance(DAY * 360, 4, (_, __, end) => steps.push(end));
  assert.equal(count, 4);
  assert.equal(timeline.limited, true);
  assert.equal(timeline.time, 4 * ORBIT_STEP);
  assert.deepEqual(steps, [ORBIT_STEP, 2 * ORBIT_STEP, 3 * ORBIT_STEP, 4 * ORBIT_STEP]);
});
