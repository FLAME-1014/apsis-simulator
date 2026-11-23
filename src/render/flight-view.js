import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GEAR_Y, LANDER } from '../physics/flight.js';
import { MARS_RADIUS, PAD_RADIUS, TERRAIN_LEVELS, noise2, terrainHeight, terrainVertex } from '../physics/terrain.js';
import { clamp, random, smoothstep, TAU } from '../physics/math.js';
import { makeSky } from './sky.js';
import { glowTexture } from './textures.js';

const SUN = new THREE.Vector3(-0.64, 0.29, -0.68).normalize();

function groundMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.99 });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying vec3 terrainPoint;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      terrainPoint = position;
    `);
    shader.fragmentShader = `
      varying vec3 terrainPoint;
      float stoneHash(vec2 q) {
        q = fract(q * vec2(0.1031, 0.11369));
        q += dot(q, q.yx + 19.19);
        return fract(q.x * q.y);
      }
      float grit(vec2 q) {
        vec2 cell = floor(q);
        vec2 v = fract(q);
        v = v * v * (3.0 - 2.0 * v);
        return mix(mix(stoneHash(cell), stoneHash(cell + vec2(1.0, 0.0)), v.x),
          mix(stoneHash(cell + vec2(0.0, 1.0)), stoneHash(cell + vec2(1.0)), v.x), v.y);
      }
      ${shader.fragmentShader}
    `;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec2 sand = terrainPoint.xz;
      float footprint = length(fwidth(sand));
      float grain = 1.0 - smoothstep(0.5, 4.2, footprint);
      float rubble = 1.0 - smoothstep(4.0, 32.0, footprint);
      float dunes = sin(sand.x * 0.092 + sand.y * 0.031 + 3.0 * grit(sand * 0.015));
      float dust = 1.0 + 0.18 * dunes * rubble + 0.28 * (grit(sand * 0.21) - 0.5) * rubble;
      dust += (grit(sand * 3.8) - 0.55) * grain * 0.44;
      diffuseColor.rgb *= dust;
    `);
  };
  return material;
}

export function terrainMesh(level, material) {
  const { step, extent } = TERRAIN_LEVELS[level];
  const hole = TERRAIN_LEVELS[level - 1]?.extent ?? 0;
  const size = extent * 2 / step;
  const row = size + 1;
  const positions = new Float32Array(row * row * 3);
  const colors = new Float32Array(positions.length);
  const indices = [];
  const rock = new THREE.Color('#744944');
  const dust = new THREE.Color('#c48565');
  const rim = new THREE.Color('#d7a382');
  const tint = new THREE.Color();
  for (let j = 0; j <= size; j++) {
    for (let i = 0; i <= size; i++) {
      const x = i * step - extent;
      const z = j * step - extent;
      const y = terrainVertex(level, x, z);
      const index = row * j + i;
      positions.set([x, y, z], 3 * index);
      const geological = noise2(x / 490, z / 490, 82) * 0.44 + noise2(x / 5900, z / 5900, 57) * 0.43;
      const dune = noise2(x / 183, z / 183, 51) * 0.19;
      tint.copy(rock).lerp(dust, clamp(0.58 + geological + dune, 0, 1));
      tint.lerp(rim, smoothstep(0.27, 0.72, geological + dune) * 0.72);
      colors.set([tint.r, tint.g, tint.b], 3 * index);
      if (i === size || j === size) continue;
      if (x >= -hole && x + step <= hole && z >= -hole && z + step <= hole) continue;
      indices.push(index, index + row, index + 1, index + 1, index + row, index + row + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function makePad() {
  const group = new THREE.Group();
  const outline = new THREE.MeshBasicMaterial({ color: '#d7f9bf', transparent: true, opacity: 0.9, side: THREE.DoubleSide, toneMapped: false });
  const secondary = new THREE.MeshBasicMaterial({ color: '#f5deb0', transparent: true, opacity: 0.72, side: THREE.DoubleSide, toneMapped: false });
  for (let i = 0; i < 4; i++) {
    const arc = new THREE.RingGeometry(PAD_RADIUS - 2, PAD_RADIUS + 1.3, 28, 1, i * TAU / 4 + 0.08, TAU / 4 - 0.16);
    arc.rotateX(-Math.PI / 2);
    const line = new THREE.Mesh(arc, outline);
    line.position.y = 0.16;
    group.add(line);
  }
  const inner = new THREE.RingGeometry(13, 13.7, 96);
  inner.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(inner, secondary);
  ring.position.y = 0.08;
  group.add(ring);
  for (let i = 0; i < 4; i++) {
    const angle = TAU * i / 4;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 7.2), secondary);
    strip.rotation.order = 'YXZ';
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.y = angle;
    strip.position.set(Math.sin(angle) * 23, 0.067, Math.cos(angle) * 23);
    group.add(strip);
  }
  return group;
}

function strut(from, to, radius, material) {
  const a = new THREE.Vector3(...from);
  const b = new THREE.Vector3(...to);
  const difference = b.clone().sub(a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, difference.length(), 10), material);
  mesh.position.copy(a).lerp(b, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), difference.normalize());
  return mesh;
}

function makeLander() {
  const lander = new THREE.Group();
  const ceramic = new THREE.MeshStandardMaterial({ color: '#e3dfd4', metalness: 0.24, roughness: 0.62 });
  const nickel = new THREE.MeshStandardMaterial({ color: '#67696d', metalness: 0.55, roughness: 0.49 });
  const foil = new THREE.MeshStandardMaterial({ color: '#ddb564', metalness: 0.53, roughness: 0.54 });
  const black = new THREE.MeshStandardMaterial({ color: '#25272c', roughness: 0.69 });
  const glass = new THREE.MeshStandardMaterial({ color: '#1a3d51', metalness: 0.45, roughness: 0.26 });
  const marker = new THREE.MeshStandardMaterial({ color: '#bde8a8', emissive: '#4d8841', emissiveIntensity: 1.2 });
  function add(geometry, material, x, y, z) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    lander.add(mesh);
    return mesh;
  }
  add(new THREE.CylinderGeometry(1.34, 1.47, 0.88, 8), foil, 0, -0.41, 0);
  add(new THREE.CylinderGeometry(1.16, 1.36, 1.12, 8), ceramic, 0, 0.58, 0);
  add(new THREE.CylinderGeometry(0.84, 1.16, 0.34, 8), nickel, 0, 1.3, 0);
  add(new THREE.CylinderGeometry(1.48, 1.48, 0.11, 8), ceramic, 0, -0.69, 0);
  add(new THREE.CylinderGeometry(0.24, 0.63, 0.42, 12), black, 0, -1.06, 0);
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI * i / 2 + Math.PI / 4;
    const window = add(new THREE.BoxGeometry(0.51, 0.31, 0.08), glass, Math.sin(angle) * 1.21, 0.72, Math.cos(angle) * 1.21);
    window.rotation.y = angle;
    add(new THREE.SphereGeometry(0.048, 8, 6), marker, Math.sin(angle) * 1.29, 0.43, Math.cos(angle) * 1.29);
  }
  add(new THREE.CylinderGeometry(0.052, 0.083, 1.07, 9), nickel, -0.49, 1.83, 0.31);
  const antenna = add(new THREE.ConeGeometry(0.37, 0.22, 18, 1, true), ceramic, -0.49, 2.37, 0.31);
  antenna.rotation.z = -0.28;
  antenna.rotation.x = Math.PI + 0.22;
  const footHeight = LANDER.footHeight;
  for (const [x, , z] of LANDER.gear) {
    add(new THREE.CylinderGeometry(LANDER.footTopRadius, LANDER.footRadius, footHeight, LANDER.footSegments),
      nickel, x, -GEAR_Y + footHeight / 2, z);
    lander.add(strut([0.35 * x, -0.49, 0.35 * z], [x, -GEAR_Y + 0.14, z], 0.085, ceramic));
    lander.add(strut([0.47 * x + z * 0.09, -0.84, 0.47 * z - x * 0.09], [x, -GEAR_Y + 0.22, z], 0.054, nickel));
    add(new THREE.SphereGeometry(0.15, 10, 7), foil, 0.37 * x, -0.52, 0.37 * z);
  }
  lander.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return lander;
}

function makePlume() {
  const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.44, 2.6, 20, 1, true), new THREE.MeshBasicMaterial({
    color: '#84c6ff', transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  mesh.rotation.x = Math.PI;
  return mesh;
}

export class FlightView {
  constructor(canvas, marsTexture) {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2('#8d5e4f', 0.00004);
    this.camera = new THREE.PerspectiveCamera(51, 1, 0.13, 23_000_000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.59;
    this.controls.minDistance = 6.7;
    this.controls.maxDistance = 135;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.sky = makeSky({ mars: true, radius: 19_000_000 });
    this.scene.add(this.sky.group);
    const ground = groundMaterial();
    this.terrain = TERRAIN_LEVELS.map((_, index) => terrainMesh(index, ground));
    this.scene.add(...this.terrain);
    // Closing the silhouette outside the height field. A slight inset leaves room for the rough surface.
    const globe = new THREE.Mesh(new THREE.SphereGeometry(MARS_RADIUS - 6200, 112, 64),
      new THREE.MeshLambertMaterial({ map: marsTexture, color: '#bf9080' }));
    globe.position.y = -MARS_RADIUS;
    this.scene.add(globe);
    this.sunlight = new THREE.DirectionalLight('#ffead3', 3.35);
    this.sunlight.shadow.mapSize.set(1024, 1024);
    const shadow = this.sunlight.shadow.camera;
    shadow.left = shadow.bottom = -25;
    shadow.top = shadow.right = 25;
    shadow.near = 0.5;
    shadow.far = 125;
    shadow.updateProjectionMatrix();
    this.sunlight.shadow.bias = -0.00019;
    this.sunlight.shadow.normalBias = 0.047;
    this.sunlight.shadow.radius = 2;
    this.scene.add(this.sunlight, this.sunlight.target, new THREE.HemisphereLight('#ffd5be', '#6e4d49', 1.38));
    this.pad = makePad();
    this.lander = makeLander();
    this.plume = makePlume();
    this.lander.add(this.plume);
    this.scene.add(this.pad, this.lander);
    this.vector = new THREE.Vector3();
    this.oldPosition = new THREE.Vector3();
    this.projected = new THREE.Vector3();
    this.view = 'chase';
    this.reset = true;

    const next = random(61529);
    this.dustStates = Array.from({ length: 39 }, () => [TAU * next(), 1.4 + 0.8 * next()]);
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.dustStates.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.dust = new THREE.Points(buffer, new THREE.PointsMaterial({
      map: glowTexture(), color: '#e4a97e', size: 1.22, transparent: true, opacity: 0.56, depthWrite: false,
    }));
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  resize(width, height) {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  changeCamera(view) {
    this.view = view;
    this.reset = true;
  }

  update(flight, pixelRatio, showPad, shadows = true) {
    const { position, throttle, time } = flight;
    const altitude = Math.max(0, flight.altitude);
    if (this.flight !== flight) {
      this.flight = flight;
      this.reset = true;
    }
    this.lander.position.fromArray(position);
    if (this.reset) {
      this.controls.target.copy(this.lander.position);
      this.controls.target.y += 0.19;
      this.camera.position.copy(this.controls.target).add(this.view === 'overhead'
        ? this.vector.set(0.02, 25, 0.42)
        : this.vector.set(10.5, 6.8, 16.5));
      this.reset = false;
    } else {
      const difference = this.vector.copy(this.lander.position).sub(this.oldPosition);
      this.camera.position.add(difference);
      this.controls.target.add(difference);
    }
    this.oldPosition.copy(this.lander.position);
    this.controls.update();
    // Camera manipulation near the pad should also respect the ground surface.
    if (altitude < 150) {
      const ground = terrainHeight(this.camera.position.x, this.camera.position.z);
      this.camera.position.y = Math.max(this.camera.position.y, ground + 1.2);
    }
    this.camera.updateMatrixWorld();
    this.sunlight.target.position.copy(this.lander.position);
    this.sunlight.position.copy(this.lander.position).addScaledVector(SUN, 70);
    this.sunlight.castShadow = shadows && altitude < 110;
    const atmosphere = 0.81 * Math.exp(-altitude / 16_800);
    this.sky.update(this.camera, pixelRatio, atmosphere);
    this.scene.fog.density = 0.0000165 * atmosphere + 0.00000012;
    this.scene.fog.color.set('#b87758').lerp(new THREE.Color('#281d2c'), 1 - atmosphere);
    this.pad.visible = showPad;
    this.plume.visible = throttle > 0.026 && altitude > 0.5;
    const flame = (0.35 + 1.78 * throttle) * (0.94 + 0.06 * Math.sin(time * 43));
    this.plume.scale.set(0.86, flame, 0.86);
    this.plume.position.y = -1.25 - 1.29 * flame;
    this.plume.material.opacity = 0.16 + 0.39 * throttle;
    this.dust.visible = altitude < 27 && throttle > 0.08;
    if (this.dust.visible) {
      const positions = this.dust.geometry.getAttribute('position');
      this.dust.material.opacity = 0.38 * (1 - altitude / 27) * Math.sqrt(throttle);
      for (let i = 0; i < this.dustStates.length; i++) {
        const [angle, strength] = this.dustStates[i];
        const life = (time * 0.7 * strength + i * 0.437) % 1;
        const radius = life * (10 + 0.25 * altitude) * strength;
        positions.setXYZ(i, position[0] + Math.cos(angle) * radius,
          position[1] - altitude - GEAR_Y + 0.1 + life * life * 3.2, position[2] + Math.sin(angle) * radius);
      }
      positions.needsUpdate = true;
    }
  }

  projectPad(width, height) {
    this.projected.set(0, 0.2, 0).project(this.camera);
    return [(this.projected.x + 1) * width / 2, (1 - this.projected.y) * height / 2,
      this.projected.z > -1 && this.projected.z < 1];
  }
}
