import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONTACT_POINTS, FLIGHT_STEP, GEAR_Y, LANDER, MarsFlight, flightClearance, sweepLander } from '../src/physics/flight.js';
import { TERRAIN_LEVELS, sweepTerrain, terrainHeight } from '../src/physics/terrain.js';
import { norm, random } from '../src/physics/math.js';
import { terrainMesh } from '../src/render/flight-view.js';

test('ground raycasts and collision heights agree on the actual rendered triangles', () => {
  const rng = random(772013);
  const meshes = TERRAIN_LEVELS.map((_, level) => terrainMesh(level));
  const ray = new THREE.Raycaster();
  ray.ray.direction.set(0, -1, 0);
  for (const mesh of meshes) mesh.updateMatrixWorld();
  for (let i = 0; i < 110; i++) {
    const level = i % TERRAIN_LEVELS.length;
    const outer = TERRAIN_LEVELS[level].extent;
    const inner = TERRAIN_LEVELS[level - 1]?.extent ?? 0;
    const x = (inner + (outer - inner) * (0.1 + 0.85 * rng())) * (rng() > 0.5 ? 1 : -1);
    const z = (2 * rng() - 1) * outer * 0.95;
    ray.ray.origin.set(x, 20_000, z);
    const hit = ray.intersectObjects(meshes)[0];
    assert.ok(hit, `No rendered ground at ${x}, ${z}`);
    const tolerance = level < 3 ? 0.00002 : 0.03;
    assert.ok(Math.abs(hit.point.y - terrainHeight(x, z)) < tolerance,
      `level ${level}: render ${hit.point.y} ≠ physics ${terrainHeight(x, z)}`);
  }
  for (const mesh of meshes) mesh.geometry.dispose();
});

test('the swept collision root matches a raycast into the production terrain mesh', () => {
  const mesh = terrainMesh(0);
  mesh.updateMatrixWorld();
  const rng = random(53490);
  const ray = new THREE.Raycaster();
  for (let i = 0; i < 75; i++) {
    const start = [(rng() - 0.5) * 410, 80 + rng() * 230, (rng() - 0.5) * 410];
    const end = [start[0] + (rng() - 0.5) * 90, -15 - rng() * 190, start[2] + (rng() - 0.5) * 90];
    ray.ray.origin.fromArray(start);
    ray.ray.direction.fromArray(end).sub(ray.ray.origin).normalize();
    const hit = ray.intersectObject(mesh)[0];
    const contact = sweepTerrain(start, end);
    assert.ok(hit && contact);
    assert.ok(hit.point.distanceTo(new THREE.Vector3(...contact.point)) < 0.00002);
  }
  mesh.geometry.dispose();
});

test('every visible bottom vertex of each sixteen-sided foot has collision support', () => {
  for (const [x, y, z] of LANDER.gear) {
    for (let i = 0; i < LANDER.footSegments; i++) {
      const angle = i * 2 * Math.PI / LANDER.footSegments;
      const point = [x + Math.sin(angle) * LANDER.footRadius, y, z + Math.cos(angle) * LANDER.footRadius];
      assert.ok(CONTACT_POINTS.some((candidate) => norm(candidate.map((value, axis) => value - point[axis])) < 1e-12));
    }
  }
});

test('all feet remain outside the ground on rough surfaces and terrain-level joins', () => {
  const rng = random(30081);
  const coordinates = [[255.8, 26], [1023.9, 4], [-4095.8, -517], [3051, -2320], [0, 0]];
  for (let i = 0; i < 50; i++) coordinates.push([(rng() - 0.5) * 14_000, (rng() - 0.5) * 14_000]);
  for (const [x, z] of coordinates) {
    const y = terrainHeight(x, z) + GEAR_Y;
    const contact = sweepLander([x, y + 24, z], [x + 0.14, y - 50, z + 0.17]);
    assert.ok(contact);
    const center = contact.point.map((value, axis) => value - contact.foot[axis]);
    assert.ok(flightClearance(center) >= -0.00001, `Clipping at ${x}, ${z}: ${flightClearance(center)}`);
  }
});

test('a hypersonic final frame stops at the first gear contact, without tunnelling', () => {
  const flight = new MarsFlight('practice');
  flight.velocity = [0, -100_000, 0];
  flight.step(FLIGHT_STEP);
  assert.equal(flight.status, 'crashed');
  assert.ok(flight.time > 0 && flight.time < FLIGHT_STEP);
  assert.ok(flightClearance(flight.position) >= -1e-7);
});

test('manual RCS takes guidance over immediately and consumes real propellant', () => {
  const flight = new MarsFlight('practice');
  flight.guidance = true;
  const fuel = flight.fuel;
  flight.step(FLIGHT_STEP, { x: 1 });
  assert.equal(flight.guidance, false);
  assert.ok(flight.thrust[0] > 0);
  assert.ok(flight.fuel < fuel);
});

test('main engine and RCS together stay inside the shared thrust limit', () => {
  const flight = new MarsFlight('practice');
  const mass = flight.fuel + LANDER.dryMass;
  flight.step(FLIGHT_STEP, { x: 1, z: 1, lift: true });
  assert.ok(norm(flight.thrust) * mass <= LANDER.maxThrust + 1e-6);
  assert.ok(flight.thrust[1] > 0 && flight.thrust[0] > 0 && flight.thrust[2] > 0);
});
