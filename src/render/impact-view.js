import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { random, smoothstep, TAU } from '../physics/math.js';
import { glowTexture, noise3 } from './textures.js';
import { makeSky } from './sky.js';

function makeRock(seed, palette) {
  const geometry = new THREE.IcosahedronGeometry(1, 8);
  const positions = geometry.getAttribute('position');
  const colors = [];
  const tint = new THREE.Color();
  const low = new THREE.Color(palette[0]);
  const high = new THREE.Color(palette[1]);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const feature = noise3(x * 2.6, y * 2.6, z * 2.6, seed);
    const grain = noise3(x * 18, y * 18, z * 18, seed + 85);
    const scale = 0.90 + 0.07 * feature + 0.03 * grain;
    positions.setXYZ(i, x * scale, y * scale, z * scale);
    tint.copy(low).lerp(high, smoothstep(0.05, 0.85, feature * 0.64 + grain * 0.36));
    colors.push(tint.r, tint.g, tint.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
}

function makeGrid() {
  const ring = new THREE.Group();
  const line = new THREE.LineBasicMaterial({ color: '#507065', transparent: true, opacity: 0.34 });
  const points = [];
  for (let i = -8; i <= 8; i++) {
    points.push(new THREE.Vector3(i, -0.64, -4.1), new THREE.Vector3(i, -0.64, 4.1));
  }
  for (let i = -4; i <= 4; i++) {
    points.push(new THREE.Vector3(-8, -0.64, i), new THREE.Vector3(8, -0.64, i));
  }
  ring.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), line));
  const center = new THREE.GridHelper(1.2, 2, '#d7f9bf', '#7a9a6e');
  center.position.y = -0.635;
  ring.add(center);
  return ring;
}

export class ImpactView {
  constructor(canvas) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(43, 1, 0.02, 1400);
    this.camera.position.set(0.6, 5.3, 10.8);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 48;
    this.controls.maxPolarAngle = Math.PI * 0.8;
    this.controls.update();
    this.sky = makeSky();
    this.scene.add(this.sky.group, makeGrid());
    const light = new THREE.DirectionalLight('#ffead0', 3.8);
    light.position.set(-5, 7, 4);
    this.scene.add(light, new THREE.HemisphereLight('#a9bedf', '#382b28', 0.97));
    this.meshes = [makeRock(291, ['#4d504d', '#a4a195']), makeRock(73, ['#6b4944', '#cfad98'])];
    this.bounds = this.meshes.map((mesh, i) => {
      this.scene.add(mesh);
      const geometry = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 1));
      const bound = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color: i === 0 ? '#c3edce' : '#e7bd94', transparent: true, opacity: 0.32,
      }));
      this.scene.add(bound);
      return bound;
    });
    this.previousTime = -1;
    this.trails = [this.makeTrail('#aed6ae'), this.makeTrail('#db9776')];
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture('sun'), color: '#ffd59a', transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.scene.add(this.flash);
    this.rng = random(739407);
    this.directions = Array.from({ length: 72 }, () => {
      const angle = this.rng() * TAU;
      const strength = 0.16 + 1.16 * this.rng();
      return [strength * Math.cos(angle), (this.rng() - 0.5) * 1.8 * strength, strength * Math.sin(angle)];
    });
    const particles = new THREE.BufferGeometry();
    particles.setAttribute('position', new THREE.Float32BufferAttribute(this.directions.flat(), 3).setUsage(THREE.DynamicDrawUsage));
    this.sparks = new THREE.Points(particles, new THREE.PointsMaterial({
      color: '#fabc7f', map: glowTexture(), transparent: true, opacity: 0.92, size: 0.048,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);
    this.projected = new THREE.Vector3();
  }

  makeTrail(color) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(384 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.76 }));
    line.frustumCulled = false;
    this.scene.add(line);
    return { geometry, count: 0 };
  }

  resize(width, height) {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  resetCamera() {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0.6, 5.3, this.camera.aspect < 1 ? 13.4 : 10.8);
    this.controls.update();
  }

  update(lab, pixelRatio, showBounds) {
    if (this.lab !== lab) {
      this.lab = lab;
      this.previousTime = -1;
      for (const trail of this.trails) {
        trail.count = 0;
        trail.geometry.setDrawRange(0, 0);
      }
    }
    const sample = lab.time - this.previousTime >= 0.095;
    for (let i = 0; i < lab.rocks.length; i++) {
      const rock = lab.rocks[i];
      const { position, radius } = rock;
      this.meshes[i].position.fromArray(position);
      this.meshes[i].scale.setScalar(radius);
      this.meshes[i].rotation.set(0.16 * lab.time + i, 0.29 * lab.time, i * 0.65 - 0.09 * lab.time);
      this.bounds[i].visible = showBounds;
      this.bounds[i].position.fromArray(position);
      this.bounds[i].scale.setScalar(radius);
      const trail = this.trails[i];
      if (sample && trail.count < 384) {
        const buffer = trail.geometry.getAttribute('position');
        buffer.setXYZ(trail.count++, position[0], -0.625, position[2]);
        trail.geometry.setDrawRange(0, trail.count);
        buffer.needsUpdate = true;
      }
    }
    if (sample) this.previousTime = lab.time;
    const impact = lab.events[0];
    const age = impact ? lab.time - impact.time : Infinity;
    this.flash.visible = this.sparks.visible = age < 1.6;
    if (age < 1.6) {
      this.flash.position.fromArray(impact.contact);
      this.flash.scale.setScalar(1.15 + age * 1.26);
      this.flash.material.opacity = 0.72 * Math.exp(-age * 3.4);
      this.sparks.position.fromArray(impact.contact);
      this.sparks.material.opacity = 1 - age / 1.6;
      const buffer = this.sparks.geometry.getAttribute('position');
      for (let i = 0; i < this.directions.length; i++) {
        const [x, y, z] = this.directions[i];
        buffer.setXYZ(i, x * age, y * age, z * age);
      }
      buffer.needsUpdate = true;
    }
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.sky.update(this.camera, pixelRatio);
  }

  project(index, width, height) {
    this.projected.copy(this.meshes[index].position);
    this.projected.y += this.meshes[index].scale.x * 1.24;
    this.projected.project(this.camera);
    return [(this.projected.x + 1) * width / 2, (1 - this.projected.y) * height / 2,
      this.projected.z > -1 && this.projected.z < 1];
  }
}
