import { clamp, mix, norm, smoothstep } from './math.js';
import { MARS } from './planets.js';

export const MARS_RADIUS = MARS.radius * 1000;
export const PAD_RADIUS = 105;
export const TERRAIN_LEVELS = [4, 16, 64, 256, 1024, 4096, 16384].map((step) => ({ step, extent: step * 64 }));
export const LEVEL_LIMIT = TERRAIN_LEVELS.at(-1).extent;
const MAX_RELIEF = 14_000;

function lattice(x, z, seed) {
  let bits = Math.imul(x, 0x9e3779b1) ^ Math.imul(z, 0x85ebca6b) ^ seed;
  bits = Math.imul(bits ^ (bits >>> 15), 0x7feb352d);
  return ((bits ^ (bits >>> 16)) >>> 0) / 2147483648 - 1;
}

export function noise2(x, z, seed) {
  const u = Math.floor(x);
  const v = Math.floor(z);
  const fx = x - u;
  const fz = z - v;
  const a = fx * fx * (3 - 2 * fx);
  const b = fz * fz * (3 - 2 * fz);
  return mix(mix(lattice(u, v, seed), lattice(u + 1, v, seed), a),
    mix(lattice(u, v + 1, seed), lattice(u + 1, v + 1, seed), a), b);
}

const CRATERS = [
  [-3100, -2350, 1620, 340], [5040, -4080, 2990, 600], [3200, 6600, 2100, 385],
  [-16100, 6200, 4830, 1020], [-27800, -10700, 6810, 1220], [18600, -31600, 8110, 1720],
  [39800, 16100, 11600, 2300], [-56000, 30100, 17200, 2400], [83300, -74100, 32700, 3210],
];

export function terrainRelief(x, z) {
  const edge = Math.hypot(x, z);
  if (edge < 140) return 0;
  const valley = 0.29 + 0.71 * smoothstep(900, 5700, Math.abs(z + x * 0.21));
  const regional = 2900 * noise2(x / 61_000, z / 61_000, 19)
    + 800 * noise2(x / 17_000, z / 17_000, 181);
  const basin = valley * (550 * noise2(x / 6800, z / 6800, 77)
    + 155 * noise2(x / 2180, z / 2180, 39))
    + 36 * noise2(x / 510, z / 510, 561) + 7 * noise2(x / 118, z / 118, 117);
  let elevation = regional * smoothstep(2800, 15_000, edge) + basin;
  for (const [cx, cz, radius, depth] of CRATERS) {
    const dx = x - cx;
    const dz = z - cz;
    if (Math.abs(dx) > radius * 1.35 || Math.abs(dz) > radius * 1.35) continue;
    const r = Math.hypot(dx, dz) / radius + 0.038 * noise2(dx / (radius * 0.4), dz / (radius * 0.4), 931);
    const bowl = 1 - smoothstep(0.17, 0.92, r);
    const rim = smoothstep(0.58, 0.94, r) * (1 - smoothstep(0.96, 1.33, r));
    elevation += depth * (0.68 * rim - bowl);
  }
  return elevation * smoothstep(140, 360, edge);
}

function trueHeight(x, z) {
  const horizontalSquared = x * x + z * z;
  const curvature = -horizontalSquared / (MARS_RADIUS + Math.sqrt(MARS_RADIUS ** 2 - horizontalSquared));
  return curvature + terrainRelief(x, z);
}

export function terrainVertex(level, x, z) {
  const { extent } = TERRAIN_LEVELS[level];
  const nextStep = TERRAIN_LEVELS[level + 1]?.step;
  // Snap the fine border to the coarse edge. The triangles then meet exactly at every seam.
  if (nextStep && Math.abs(x) === extent && z % nextStep !== 0) {
    const start = Math.floor(z / nextStep) * nextStep;
    return mix(trueHeight(x, start), trueHeight(x, start + nextStep), (z - start) / nextStep);
  }
  if (nextStep && Math.abs(z) === extent && x % nextStep !== 0) {
    const start = Math.floor(x / nextStep) * nextStep;
    return mix(trueHeight(start, z), trueHeight(start + nextStep, z), (x - start) / nextStep);
  }
  return trueHeight(x, z);
}

export function terrainCell(x, z) {
  const extent = Math.max(Math.abs(x), Math.abs(z));
  let level = 0;
  while (level < TERRAIN_LEVELS.length - 1 && extent >= TERRAIN_LEVELS[level].extent) level++;
  const { step } = TERRAIN_LEVELS[level];
  const x0 = Math.floor(x / step) * step;
  const z0 = Math.floor(z / step) * step;
  return {
    x0, z0, step, level,
    h00: terrainVertex(level, x0, z0), h10: terrainVertex(level, x0 + step, z0),
    h01: terrainVertex(level, x0, z0 + step), h11: terrainVertex(level, x0 + step, z0 + step),
  };
}

function planeHeight(cell, x, z) {
  const { x0, z0, step, h00, h10, h01, h11 } = cell;
  const u = (x - x0) / step;
  const v = (z - z0) / step;
  return u + v <= 1
    ? h00 + (h10 - h00) * u + (h01 - h00) * v
    : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

function planeNormal(cell, x, z) {
  const { x0, z0, step, h00, h10, h01, h11 } = cell;
  const lower = x - x0 + z - z0 <= step;
  const riseX = lower ? h10 - h00 : h11 - h01;
  const riseZ = lower ? h01 - h00 : h11 - h10;
  const direction = [-riseX, step, -riseZ];
  const magnitude = norm(direction);
  return direction.map((value) => value / magnitude);
}

export function terrainHeight(x, z) {
  return planeHeight(terrainCell(x, z), x, z);
}

export function terrainNormal(x, z) {
  return planeNormal(terrainCell(x, z), x, z);
}

/** First intersection of a swept point and the exact terrain triangles. */
export function sweepTerrain(start, end) {
  if (start[1] > MAX_RELIEF && end[1] > MAX_RELIEF) return null;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const dz = end[2] - start[2];
  const probe = 1e-6 / Math.max(1, Math.abs(dx), Math.abs(dz));
  let time = 0;
  while (time < 1) {
    const inside = Math.min(1, time + probe);
    const cell = terrainCell(start[0] + dx * inside, start[2] + dz * inside);
    const boundary = (origin, velocity, low) => velocity === 0 ? Infinity
      : (low + (velocity > 0 ? cell.step : 0) - origin) / velocity;
    const leave = Math.min(1, boundary(start[0], dx, cell.x0), boundary(start[2], dz, cell.z0));
    if (leave <= time) {
      // At a floating-point grid boundary, move the probe to the forward cell.
      time = Math.min(1, time + probe);
      continue;
    }
    const diagonal = (cell.x0 + cell.z0 + cell.step - start[0] - start[2]) / (dx + dz);
    const stops = diagonal > time && diagonal < leave ? [diagonal, leave] : [leave];
    const clearance = (t) => start[1] + dy * t - planeHeight(cell, start[0] + dx * t, start[2] + dz * t);
    let height = clearance(time);
    for (const stop of stops) {
      const nextHeight = clearance(stop);
      if (height < -1e-7 || (nextHeight <= 0 && nextHeight < height)) {
        const fraction = height <= 0 ? time : mix(time, stop, clamp(height / (height - nextHeight), 0, 1));
        const x = start[0] + dx * fraction;
        const z = start[2] + dz * fraction;
        return { fraction, point: [x, planeHeight(cell, x, z), z], normal: planeNormal(cell, x, z) };
      }
      time = stop;
      height = nextHeight;
    }
  }
  return null;
}
