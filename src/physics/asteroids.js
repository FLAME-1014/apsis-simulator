import { cross, dot, norm, random, scale, sub } from './math.js';
import { frameFromJpl, stateOnEllipse } from './orbits.js';

export const RESTITUTION = 0.62;

/** First time in [0, duration] at which two linearly moving spheres touch. */
export function sphereImpactTime(a, va, b, vb, radius, duration) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const vx = vb[0] - va[0];
  const vy = vb[1] - va[1];
  const vz = vb[2] - va[2];
  const limit = radius * radius;
  const c = dx * dx + dy * dy + dz * dz - limit;
  const halfB = dx * vx + dy * vy + dz * vz;
  if (c < -1e-12 * limit) return 0;
  if (c <= 1e-12 * limit && halfB < 0) return 0;
  if (halfB >= 0) return null;
  const squaredSpeed = vx * vx + vy * vy + vz * vz;
  const discriminant = halfB * halfB - squaredSpeed * c;
  if (discriminant < 0 || squaredSpeed === 0) return null;
  const t = c / (-halfB + Math.sqrt(discriminant));
  return t <= duration ? Math.max(0, t) : null;
}

/** Apply a frictionless contact impulse and remove residual penetration. */
export function resolveSphereImpact(first, second, restitution = RESTITUTION) {
  const difference = sub(second.position, first.position);
  const distance = norm(difference);
  const relative = sub(second.velocity, first.velocity);
  const relativeSpeed = norm(relative);
  const normal = distance > 1e-15 ? scale(difference, 1 / distance)
    : relativeSpeed ? scale(relative, -1 / relativeSpeed) : [1, 0, 0];
  const inverseMassA = 1 / first.mass;
  const inverseMassB = 1 / second.mass;
  const inverseTotal = inverseMassA + inverseMassB;
  const incomingNormalSpeed = Math.max(0, -dot(relative, normal));
  const impulse = (1 + restitution) * incomingNormalSpeed / inverseTotal;
  const radius = first.radius + second.radius;
  const separation = Math.max(0, radius - distance + radius * 1e-10) / inverseTotal;
  for (let k = 0; k < 3; k++) {
    first.velocity[k] -= impulse * normal[k] * inverseMassA;
    second.velocity[k] += impulse * normal[k] * inverseMassB;
    first.position[k] -= separation * normal[k] * inverseMassA;
    second.position[k] += separation * normal[k] * inverseMassB;
  }
  return { normal, impulse, incomingNormalSpeed };
}

function insideSweptBounds(first, second, radius, duration) {
  for (let axis = 0; axis < 3; axis++) {
    const start = second.position[axis] - first.position[axis];
    const end = start + duration * (second.velocity[axis] - first.velocity[axis]);
    if (Math.min(start, end) > radius || Math.max(start, end) < -radius) return false;
  }
  return true;
}

function move(bodies, dt) {
  for (const body of bodies) {
    if (body.removed) continue;
    for (let k = 0; k < 3; k++) body.position[k] += dt * body.velocity[k];
  }
}

/** Resolve impacts in chronological order during the linear drift of a leapfrog step. */
export function driftAsteroids(rocks, dt, {
  planets = [], restitution = RESTITUTION, onImpact, maxEvents = Math.max(16, rocks.length * 4),
} = {}) {
  let elapsed = 0;
  let count = 0;
  while (elapsed < dt && count < maxEvents) {
    const remaining = dt - elapsed;
    let earliest = Infinity;
    let first;
    let second;
    let absorbs;
    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i];
      if (rock.removed) continue;
      for (let j = i + 1; j < rocks.length; j++) {
        const other = rocks[j];
        const radius = rock.radius + other.radius;
        if (other.removed || !insideSweptBounds(rock, other, radius, remaining)) continue;
        const t = sphereImpactTime(rock.position, rock.velocity, other.position, other.velocity, radius, remaining);
        if (t !== null && t < earliest) {
          earliest = t;
          first = rock;
          second = other;
          absorbs = false;
        }
      }
      for (const planet of planets) {
        const radius = rock.radius + planet.radius;
        if (!insideSweptBounds(rock, planet, radius, remaining)) continue;
        const t = sphereImpactTime(rock.position, rock.velocity, planet.position, planet.velocity, radius, remaining);
        if (t !== null && t < earliest) {
          earliest = t;
          first = rock;
          second = planet;
          absorbs = true;
        }
      }
    }
    const advance = Math.min(remaining, earliest);
    move(rocks, advance);
    move(planets, advance);
    elapsed += advance;
    if (!first) break;
    const contact = first.position.map((value, i) => value + (second.position[i] - value)
      * first.radius / (first.radius + second.radius));
    if (absorbs) {
      first.removed = true;
      first.removedAt = elapsed;
      onImpact?.({ time: elapsed, a: first.id, b: second.id, contact, absorbed: true });
    } else {
      const response = resolveSphereImpact(first, second, restitution);
      if (response.impulse > 0) {
        onImpact?.({ time: elapsed, a: first.id, b: second.id, contact, ...response });
      }
    }
    count++;
  }
  return { elapsed, limited: elapsed < dt };
}

export function makeBelt(sun, count = 44, seed = 0xa9515) {
  const next = random(seed);
  return Array.from({ length: count }, (_, index) => {
    const radius = 30 + 145 * next() ** 2;
    const elements = [2.18 + 1.06 * next(), 0.025 + 0.12 * next(), 1 + 14 * next() ** 2,
      360 * next(), 360 * next(), 360 * next()];
    const state = stateOnEllipse(frameFromJpl(elements, sun.mu));
    return {
      id: `Belt ${String(index + 1).padStart(2, '0')}`, radius, mass: radius ** 3, removed: false,
      position: state.position.map((value, k) => value + sun.position[k]),
      velocity: state.velocity.map((value, k) => value + sun.velocity[k]),
      previous: [0, 0, 0], acceleration: [0, 0, 0],
    };
  });
}

function testAcceleration(rock, planets) {
  const out = rock.acceleration;
  out.fill(0);
  for (const body of planets) {
    const dx = body.position[0] - rock.position[0];
    const dy = body.position[1] - rock.position[1];
    const dz = body.position[2] - rock.position[2];
    const r2 = dx * dx + dy * dy + dz * dz;
    const weight = body.mu / (r2 * Math.sqrt(r2));
    out[0] += weight * dx;
    out[1] += weight * dy;
    out[2] += weight * dz;
  }
}

export class BeltDynamics {
  constructor(planets, count) {
    this.rocks = makeBelt(planets[0], count);
    this.targets = planets.map(({ id, radius, position, velocity }) => ({
      id, radius, position: position.slice(), velocity: velocity.slice(),
    }));
    this.impactCount = 0;
    this.lastImpact = null;
    for (const rock of this.rocks) {
      rock.previous = rock.position.slice();
      testAcceleration(rock, planets);
    }
  }

  step(before, after, dt, endTime) {
    for (let i = 0; i < this.targets.length; i++) {
      for (let k = 0; k < 3; k++) {
        this.targets[i].position[k] = before[i].position[k];
        this.targets[i].velocity[k] = (after[i].position[k] - before[i].position[k]) / dt;
      }
    }
    for (const rock of this.rocks) {
      rock.wasRemoved = rock.removed;
      if (rock.removed) continue;
      for (let k = 0; k < 3; k++) {
        rock.previous[k] = rock.position[k];
        rock.velocity[k] += 0.5 * dt * rock.acceleration[k];
      }
    }
    driftAsteroids(this.rocks, dt, {
      planets: this.targets,
      onImpact: (event) => {
        this.impactCount++;
        this.lastImpact = { ...event, time: endTime - dt + event.time };
      },
    });
    for (const rock of this.rocks) {
      if (rock.removed) continue;
      testAcceleration(rock, after);
      for (let k = 0; k < 3; k++) rock.velocity[k] += 0.5 * dt * rock.acceleration[k];
    }
  }
}

export const TRIALS = {
  direct: { label: 'Head-on', offset: 0 },
  grazing: { label: 'Glancing', offset: 0.77 },
  miss: { label: 'Near miss', offset: 1.19 },
};

export function rockEnergy(rocks) {
  return rocks.reduce((total, rock) => total + 0.5 * rock.mass * dot(rock.velocity, rock.velocity), 0);
}

export function rockAngularMomentum(rocks) {
  return rocks.reduce((total, rock) => {
    const direction = cross(rock.position, rock.velocity);
    return total.map((value, i) => value + rock.mass * direction[i]);
  }, [0, 0, 0]);
}

export class ImpactLab {
  constructor(trial = 'grazing') {
    this.trial = trial;
    const offset = TRIALS[trial].offset;
    // Constant density 2.6×10^12 kg/km³. Visual mesh irregularity stays within the sphere.
    const make = (id, radius, position, velocity) => ({
      id, radius, position, velocity, mass: 2.6e12 * 4 / 3 * Math.PI * radius ** 3,
    });
    this.rocks = [make('A-17', 0.59, [-3, 0, offset / 2], [0.21, 0, 0]),
      make('B-04', 0.4, [3, 0, -offset / 2], [-0.33, 0, 0])];
    this.restitution = RESTITUTION;
    this.time = 0;
    this.duration = 25;
    this.events = [];
    this.initialEnergy = rockEnergy(this.rocks);
  }

  step(dt) {
    if (this.time >= this.duration) return false;
    const duration = Math.min(dt, this.duration - this.time);
    driftAsteroids(this.rocks, duration, {
      restitution: this.restitution,
      onImpact: (event) => this.events.push({ ...event, time: this.time + event.time }),
    });
    this.time += duration;
    return this.time < this.duration;
  }
}
