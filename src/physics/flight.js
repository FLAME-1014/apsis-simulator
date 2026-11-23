import { clamp, dot, mix, norm, scale } from './math.js';
import { MARS } from './planets.js';
import { LEVEL_LIMIT, MARS_RADIUS, PAD_RADIUS, sweepTerrain, terrainHeight } from './terrain.js';

export const FLIGHT_STEP = 1 / 60;
export const GEAR_Y = 2.62;
export const LANDER = {
  dryMass: 8200, fuel: 13_500, maxThrust: 420_000, exhaustVelocity: 3200,
  lateralAcceleration: 8, verticalLimit: 5, lateralLimit: 4, slopeLimit: 12,
  footRadius: 0.45, footTopRadius: 0.38, footHeight: 0.16, footSegments: 16,
  gear: [[2.85, -GEAR_Y, 0], [-1.425, -GEAR_Y, 2.46817], [-1.425, -GEAR_Y, -2.46817]],
};
export const CONTACT_POINTS = [
  ...LANDER.gear.flatMap((center) => [center, ...Array.from({ length: LANDER.footSegments }, (_, i) => {
    const angle = 2 * Math.PI * i / LANDER.footSegments;
    return [center[0] + LANDER.footRadius * Math.sin(angle), center[1], center[2] + LANDER.footRadius * Math.cos(angle)];
  })]),
  [0, -1.28, 0],
];
const MARS_MU = MARS.mu * 1e9;

export function marsGravity([x, y, z]) {
  const radius = [x, y + MARS_RADIUS, z];
  return scale(radius, -MARS_MU / norm(radius) ** 3);
}

export function landingCheck(position, velocity, normal) {
  const normalSpeed = dot(velocity, normal);
  const vertical = Math.abs(normalSpeed);
  const lateral = norm(velocity.map((value, i) => value - normalSpeed * normal[i]));
  const slope = Math.acos(clamp(normal[1], -1, 1)) * 180 / Math.PI;
  const range = Math.hypot(position[0], position[2]);
  const safe = vertical <= LANDER.verticalLimit && lateral <= LANDER.lateralLimit && slope <= LANDER.slopeLimit;
  return { vertical, lateral, slope, range, safe, status: safe ? (range <= PAD_RADIUS ? 'landed' : 'off-pad') : 'crashed' };
}

function limitLateral(x, z, limit) {
  const magnitude = Math.hypot(x, z);
  const ratio = magnitude > limit ? limit / magnitude : 1;
  return [x * ratio, z * ratio];
}

export function descentGuidance(position, velocity, altitude, gravity, capacity) {
  const [x, , z] = position;
  const range = Math.hypot(x, z);
  const effectiveHeight = Math.max(0, altitude);
  const speedLimit = Math.min(885, 17 + effectiveHeight * 0.58, Math.sqrt(2 * 4.8 * range));
  const approachTime = Math.max(1.3, Math.sqrt(effectiveHeight / 12));
  const [targetX, targetZ] = limitLateral(-x / approachTime, -z / approachTime, speedLimit);
  let targetY = -Math.min(1020, 1.78 + 0.124 * effectiveHeight, 1.78 + Math.sqrt(2 * 6.0 * effectiveHeight));
  if (range > 76 && effectiveHeight < 360) targetY = clamp((190 - effectiveHeight) * 0.13, -24, 20);
  const y = clamp((targetY - velocity[1]) * 0.92 - gravity[1], 0, capacity);
  const remaining = Math.min(LANDER.lateralAcceleration, Math.sqrt(Math.max(0, capacity ** 2 - y ** 2)));
  const [thrustX, thrustZ] = limitLateral((targetX - velocity[0]) * 0.72 - gravity[0],
    (targetZ - velocity[2]) * 0.72 - gravity[2], remaining);
  return [thrustX, y, thrustZ];
}

export function sweepLander(start, end) {
  if (start[1] - GEAR_Y > 14_000 && end[1] - GEAR_Y > 14_000) return null;
  let first = null;
  for (const foot of CONTACT_POINTS) {
    const sweep = sweepTerrain(start.map((value, i) => value + foot[i]), end.map((value, i) => value + foot[i]));
    if (sweep && (!first || sweep.fraction < first.fraction)) first = { ...sweep, foot };
  }
  return first;
}

export function flightClearance(position) {
  const [x, y, z] = position;
  return Math.min(...CONTACT_POINTS.map(([ox, oy, oz]) => y + oy - terrainHeight(x + ox, z + oz)));
}

export function phaseForAltitude(altitude) {
  if (altitude > 20_000) return 'approach';
  if (altitude > 1800) return 'braking';
  if (altitude > 150) return 'descent';
  return 'final';
}

export function allowedFlightRate(altitude) {
  if (altitude > 3000) return 8;
  if (altitude > 550) return 4;
  if (altitude > 130) return 2;
  return 1;
}

export class MarsFlight {
  constructor(checkpoint = 'approach') {
    const final = checkpoint === 'practice';
    const position = final ? [-35, 235, 44] : [-52_000, 106_000, 14_000];
    position[1] += terrainHeight(position[0], position[2]) + GEAR_Y;
    this.position = position;
    this.velocity = final ? [0.8, -9, -1] : [462, -920, -124];
    this.fuel = final ? 3680 : LANDER.fuel;
    this.startFuel = this.fuel;
    this.time = 0;
    this.status = 'flying';
    this.guidance = false;
    this.checkpoint = checkpoint;
    this.throttle = 0;
    this.thrust = [0, 0, 0];
    this.contact = null;
  }

  get altitude() {
    const [x, y, z] = this.position;
    const approximate = y - GEAR_Y - terrainHeight(x, z);
    return approximate < 30 ? flightClearance(this.position) : approximate;
  }

  step(dt = FLIGHT_STEP, controls = {}) {
    if (this.status !== 'flying') return false;
    const mass = this.fuel + LANDER.dryMass;
    const capacity = this.fuel > 0 ? LANDER.maxThrust / mass : 0;
    const gravity = marsGravity(this.position);
    const manual = controls.lift || controls.x || controls.z || controls.brake;
    if (manual) this.guidance = false;
    let command;
    if (this.guidance && capacity > 0) {
      command = descentGuidance(this.position, this.velocity, this.altitude, gravity, capacity);
    } else {
      const vertical = controls.lift ? capacity : 0;
      const lateral = controls.brake
        ? limitLateral(-this.velocity[0] * 2, -this.velocity[2] * 2, LANDER.lateralAcceleration)
        : limitLateral((controls.x || 0) * LANDER.lateralAcceleration, (controls.z || 0) * LANDER.lateralAcceleration,
          LANDER.lateralAcceleration);
      // Lateral RCS and the main engine share one total force budget.
      command = [lateral[0], vertical, lateral[1]];
      const magnitude = norm(command);
      if (magnitude > capacity) command = scale(command, capacity / magnitude);
    }

    const demand = norm(command) * mass * dt / LANDER.exhaustVelocity;
    const fuelUsed = Math.min(demand, this.fuel);
    const thrust = demand > 0 && fuelUsed < demand ? scale(command, fuelUsed / demand) : command;
    const position = this.position.map((value, i) => value + (this.velocity[i] + 0.5 * (gravity[i] + thrust[i]) * dt) * dt);
    const gravityAtEnd = marsGravity(position);
    const velocity = this.velocity.map((value, i) => value + (0.5 * (gravity[i] + gravityAtEnd[i]) + thrust[i]) * dt);

    if (Math.max(Math.abs(position[0]), Math.abs(position[2])) >= LEVEL_LIMIT - 2000 || position[1] > 900_000) {
      this.status = 'departed';
      this.throttle = 0;
      this.thrust = [0, 0, 0];
      return false;
    }
    const contact = sweepLander(this.position, position);
    const fraction = contact?.fraction ?? 1;
    this.time += fraction * dt;
    this.fuel -= fraction * fuelUsed;
    if (contact) {
      this.position = contact.point.map((value, i) => value - contact.foot[i]);
      this.position[1] += 1e-8;
      const incoming = this.velocity.map((value, i) => mix(value, velocity[i], contact.fraction));
      this.contact = { ...landingCheck(this.position, incoming, contact.normal), point: contact.point, velocity: incoming };
      this.velocity = [0, 0, 0];
      this.status = this.contact.status;
      this.throttle = 0;
      this.thrust = [0, 0, 0];
      return false;
    }
    this.position = position;
    this.velocity = velocity;
    this.thrust = thrust;
    this.throttle = norm(thrust) * mass / LANDER.maxThrust;
    return true;
  }
}
