import assert from 'node:assert/strict';
import { YEAR } from '../src/physics/planets.js';
import { frameFromState } from '../src/physics/orbits.js';
import { SolarSystem, invariants, ORBIT_STEP } from '../src/physics/solar-system.js';
import { inspectPlanet } from '../src/physics/telemetry.js';
import { norm } from '../src/physics/math.js';
import { mkdir, writeFile } from 'node:fs/promises';

const years = Number(process.argv[2] ?? 1000);
if (!(years > 0 && years <= 3000)) throw new RangeError('Choose between 0 and 3000 simulated years.');
const count = Math.round(years * YEAR / ORBIT_STEP);
const system = new SolarSystem();
const initialEnergy = invariants(system.bodies);
const semimajorAxes = system.bodies.slice(1).map((body) => frameFromState(
  body.position.map((value, axis) => value - system.bodies[0].position[axis]),
  body.velocity.map((value, axis) => value - system.bodies[0].velocity[axis]), system.bodies[0].mu + body.mu).a);
const milestones = new Set([0.1, 0.25, 0.5, 0.75, 1].map((fraction) => Math.floor(count * fraction)));
const samples = [];
let maxSampledEnergyDrift = 0;
let maxSampledAngularMomentumDrift = 0;
for (let i = 1; i <= count; i++) {
  system.step();
  if (i % 24 !== 0 && !milestones.has(i)) continue;
  const current = invariants(system.bodies);
  const energyDrift = Math.abs((current.energy - initialEnergy.energy) / initialEnergy.energy);
  const angularMomentumDrift = norm(current.angularMomentum.map((value, j) => value - initialEnergy.angularMomentum[j]))
    / norm(initialEnergy.angularMomentum);
  maxSampledEnergyDrift = Math.max(maxSampledEnergyDrift, energyDrift);
  maxSampledAngularMomentumDrift = Math.max(maxSampledAngularMomentumDrift, angularMomentumDrift);
  assert.ok(energyDrift < 0.0002, `${i} steps, relative energy drift ${energyDrift}`);
  assert.ok(angularMomentumDrift < 0.00001, `${i} steps, relative angular-momentum drift ${angularMomentumDrift}`);
  if (!milestones.has(i)) continue;
  const earth = inspectPlanet(3, system.bodies);
  const mars = inspectPlanet(4, system.bodies);
  const neptune = inspectPlanet(8, system.bodies);
  assert.ok(earth.distanceAU > 0.97 && earth.distanceAU < 1.04, `${i} steps, Earth at ${earth.distanceAU} AU`);
  assert.ok(mars.distanceAU > 1.3 && mars.distanceAU < 1.75, `${i} steps, Mars at ${mars.distanceAU} AU`);
  assert.ok(neptune.distanceAU > 29 && neptune.distanceAU < 31, `${i} steps, Neptune at ${neptune.distanceAU} AU`);
  for (let j = 1; j < system.bodies.length; j++) {
    const { position, velocity } = system.bodies[j];
    assert.ok(frameFromState(system.bodies[0].position.map((value, k) => position[k] - value),
      system.bodies[0].velocity.map((value, k) => velocity[k] - value), system.bodies[0].mu + system.bodies[j].mu),
    `body ${system.bodies[j].id} has become unbound after ${years * i / count} years`);
  }
  samples.push({ year: +(years * i / count).toFixed(1), relativeEnergyDrift: energyDrift,
    relativeAngularMomentumDrift: angularMomentumDrift, earthAU: +earth.distanceAU.toFixed(5),
    marsAU: +mars.distanceAU.toFixed(5), neptuneAU: +neptune.distanceAU.toFixed(5) });
  process.stdout.write(`Checked year ${samples.at(-1).year.toFixed(1)} / ${years}: E ${energyDrift.toExponential(3)}, L ${angularMomentumDrift.toExponential(3)}\n`);
}

const report = { simulation: 'all nine massive bodies; direct Newtonian pair gravity; symplectic leapfrog',
  years, steps: count, fixedStepSeconds: ORBIT_STEP, epochSeconds: system.time,
  conservationSamplingIntervalSeconds: 24 * ORBIT_STEP, maxSampledEnergyDrift, maxSampledAngularMomentumDrift,
  initialSemiMajorAxisKm: semimajorAxes.map((a) => Math.round(a)),
  finalElements: system.bodies.slice(1).map((body) => ({ id: body.id,
    ...(frameFromState(system.bodies[0].position.map((value, k) => body.position[k] - value),
      system.bodies[0].velocity.map((value, k) => body.velocity[k] - value), system.bodies[0].mu + body.mu) ?? {}),
  })), milestones: samples };
await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
await writeFile(new URL('../artifacts/long-run.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ years, steps: count, maxSampledEnergyDrift, maxSampledAngularMomentumDrift, milestones: samples,
  report: 'artifacts/long-run.json' }, null, 2));
