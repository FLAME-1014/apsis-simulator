import { PLANETS } from './planets.js';
import { frameFromJpl, stateOnEllipse } from './orbits.js';
import { cross, dot, norm, sub } from './math.js';

export const ORBIT_STEP = 3600;

export function recenter(bodies) {
  const totalMu = bodies.reduce((sum, body) => sum + body.mu, 0);
  const position = [0, 0, 0];
  const velocity = [0, 0, 0];
  for (const body of bodies) {
    const weight = body.mu / totalMu;
    for (let k = 0; k < 3; k++) {
      position[k] += weight * body.position[k];
      velocity[k] += weight * body.velocity[k];
    }
  }
  for (const body of bodies) {
    for (let k = 0; k < 3; k++) {
      body.position[k] -= position[k];
      body.velocity[k] -= velocity[k];
    }
  }
  return bodies;
}

export function initialSolarBodies() {
  return recenter(PLANETS.map((body) => ({
    id: body.id, mu: body.mu, radius: body.radius,
    ...(body.elements
      ? stateOnEllipse(frameFromJpl(body.elements, PLANETS[0].mu + body.mu))
      : { position: [0, 0, 0], velocity: [0, 0, 0] }),
  })));
}

export function pairAccelerations(bodies, output = bodies.map(() => [0, 0, 0])) {
  for (const acceleration of output) acceleration.fill(0);
  for (let i = 0; i < bodies.length; i++) {
    const first = bodies[i];
    for (let j = i + 1; j < bodies.length; j++) {
      const second = bodies[j];
      const dx = second.position[0] - first.position[0];
      const dy = second.position[1] - first.position[1];
      const dz = second.position[2] - first.position[2];
      const r2 = dx * dx + dy * dy + dz * dz;
      if (!(r2 > 0)) throw new RangeError('Overlapping centers in the massive body model');
      const inverseCube = 1 / (r2 * Math.sqrt(r2));
      const a = second.mu * inverseCube;
      const b = first.mu * inverseCube;
      output[i][0] += dx * a;
      output[i][1] += dy * a;
      output[i][2] += dz * a;
      output[j][0] -= dx * b;
      output[j][1] -= dy * b;
      output[j][2] -= dz * b;
    }
  }
  return output;
}

export function cloneStates(bodies) {
  return bodies.map((body) => ({ ...body, position: body.position.slice(), velocity: body.velocity.slice() }));
}

export class SolarSystem {
  constructor(bodies = initialSolarBodies()) {
    this.bodies = cloneStates(bodies);
    this.time = 0;
    this.accelerations = pairAccelerations(this.bodies);
  }

  step(dt = ORBIT_STEP) {
    // Kick–drift–kick leapfrog. The acceleration at this step's end is reused.
    const half = dt * 0.5;
    for (let i = 0; i < this.bodies.length; i++) {
      const { position, velocity } = this.bodies[i];
      const acceleration = this.accelerations[i];
      for (let axis = 0; axis < 3; axis++) {
        velocity[axis] += half * acceleration[axis];
        position[axis] += dt * velocity[axis];
      }
    }
    pairAccelerations(this.bodies, this.accelerations);
    for (let i = 0; i < this.bodies.length; i++) {
      for (let axis = 0; axis < 3; axis++) this.bodies[i].velocity[axis] += half * this.accelerations[i][axis];
    }
    this.time += dt;
  }
}

export function invariants(bodies) {
  const momentum = [0, 0, 0];
  const angularMomentum = [0, 0, 0];
  const center = [0, 0, 0];
  const totalMu = bodies.reduce((sum, body) => sum + body.mu, 0);
  let energy = 0;
  for (let i = 0; i < bodies.length; i++) {
    const { position, velocity, mu } = bodies[i];
    const mass = mu / totalMu;
    const h = cross(position, velocity);
    energy += 0.5 * mass * dot(velocity, velocity);
    for (let k = 0; k < 3; k++) {
      momentum[k] += mass * velocity[k];
      center[k] += mass * position[k];
      angularMomentum[k] += mass * h[k];
    }
    for (let j = i + 1; j < bodies.length; j++) {
      energy -= mass * bodies[j].mu / norm(sub(position, bodies[j].position));
    }
  }
  return { energy, momentum, angularMomentum, center };
}

function copyStates(from, to) {
  for (let i = 0; i < from.length; i++) {
    for (let k = 0; k < 3; k++) {
      to[i].position[k] = from[i].position[k];
      to[i].velocity[k] = from[i].velocity[k];
    }
  }
}

export class SolarTimeline {
  constructor() {
    this.system = new SolarSystem();
    this.previous = cloneStates(this.system.bodies);
    this.sample = cloneStates(this.system.bodies);
    this.time = 0;
    this.limited = false;
  }

  advance(seconds, maxSteps = 48, onStep) {
    const desired = this.time + Math.max(0, seconds);
    let steps = 0;
    while (this.system.time < desired && steps < maxSteps) {
      copyStates(this.system.bodies, this.previous);
      this.system.step();
      onStep?.(this.previous, this.system.bodies, this.system.time);
      steps++;
    }
    this.limited = desired > this.system.time;
    this.time = Math.min(desired, this.system.time);
    return steps;
  }

  read() {
    if (this.system.time === 0) return this.sample;
    const t = 1 - (this.system.time - this.time) / ORBIT_STEP;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    for (let i = 0; i < this.sample.length; i++) {
      const a = this.previous[i];
      const b = this.system.bodies[i];
      const out = this.sample[i];
      for (let k = 0; k < 3; k++) {
        out.position[k] = h00 * a.position[k] + h10 * ORBIT_STEP * a.velocity[k]
          + h01 * b.position[k] + h11 * ORBIT_STEP * b.velocity[k];
        out.velocity[k] = (6 * t2 - 6 * t) * (a.position[k] - b.position[k]) / ORBIT_STEP
          + (3 * t2 - 4 * t + 1) * a.velocity[k] + (3 * t2 - 2 * t) * b.velocity[k];
      }
    }
    return this.sample;
  }
}
