import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AU, DAY, PLANETS } from '../physics/planets.js';
import { ORBIT_STEP } from '../physics/solar-system.js';
import { ellipsePoint, frameFromState } from '../physics/orbits.js';
import { mix, random, sub, TAU } from '../physics/math.js';
import { glowTexture, makePlanetTexture } from './textures.js';
import { makeSky } from './sky.js';

// The camera uses a monotonic log scale. Integration and telemetry always use km.
export function mapOrbit(x, y, z, out = new THREE.Vector3()) {
  const distance = Math.hypot(x, y, z);
  const factor = distance ? 11 * Math.log1p(3.65 * distance / AU) / distance : 0;
  return out.set(x * factor, y * factor, z * factor);
}

function planetAtmosphere(body, geometry) {
  const [color, scale, strength] = body.atmosphere;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      tint: { value: new THREE.Color(color) },
      strength: { value: strength },
      sunDirection: { value: new THREE.Vector3(1, 0, 0) },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 normalWorld;
      varying vec3 world;
      void main() {
        normalWorld = mat3(modelMatrix) * normal;
        world = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      varying vec3 normalWorld;
      varying vec3 world;
      uniform vec3 tint;
      uniform float strength;
      uniform vec3 sunDirection;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 n = normalize(normalWorld);
        vec3 view = normalize(cameraPosition - world);
        float grazing = pow(max(0.0, 1.0 - abs(dot(view, n))), 3.3);
        float day = smoothstep(-0.24, 0.6, dot(n, sunDirection));
        float alpha = strength * grazing * (0.085 + 0.915 * day);
        gl_FragColor = vec4(tint, alpha);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(body.size * scale);
  return mesh;
}

function saturnRings(radius) {
  const geometry = new THREE.RingGeometry(radius * 1.21, radius * 2.27, 216, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: { radius: { value: radius }, sunDirection: { value: new THREE.Vector3() } },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 relative;
      void main() {
        relative = mat3(modelMatrix) * position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      varying vec3 relative;
      uniform vec3 sunDirection;
      uniform float radius;
      void main() {
        #include <logdepthbuf_fragment>
        float r = length(relative) / radius;
        float fine = 0.56 + 0.2 * sin(279.0 * r) + 0.13 * sin(468.0 * r + 1.3 * sin(r * 46.0));
        float gap = smoothstep(0.023, 0.045, abs(r - 1.918));
        float edge = smoothstep(1.21, 1.36, r) * (1.0 - smoothstep(2.18, 2.27, r));
        float shadeRay = dot(relative, sunDirection);
        float tangent = sqrt(max(0.0, dot(relative, relative) - shadeRay * shadeRay));
        float shadow = shadeRay < 0.0 ? mix(0.16, 1.0, smoothstep(radius * 0.94, radius * 1.03, tangent)) : 1.0;
        vec3 dust = mix(vec3(0.50, 0.32, 0.18), vec3(0.83, 0.68, 0.45), 0.57 + 0.36 * sin(r * 18.0));
        gl_FragColor = vec4(dust * shadow, edge * fine * mix(0.10, 1.0, gap));
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  return new THREE.Mesh(geometry, material);
}

function makeBeltDust() {
  const next = random(19442);
  const count = 3100;
  const states = new Float32Array(count * 4);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const radius = 2.09 + 1.22 * (next() + next()) / 2;
    states.set([radius, TAU * next(), (next() - 0.5) * 1.25, 0.15 + 0.64 * next() ** 3], i * 4);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('orbit', new THREE.BufferAttribute(states, 4));
  const material = new THREE.ShaderMaterial({
    uniforms: { years: { value: 0 }, pixelRatio: { value: 1 } },
    transparent: true, depthWrite: false,
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec4 orbit;
      uniform float years;
      uniform float pixelRatio;
      varying float brightness;
      void main() {
        float angle = orbit.y + 6.28318530718 * years / pow(orbit.x, 1.5);
        float distance = 11.0 * log(1.0 + 3.65 * orbit.x);
        vec3 p = vec3(distance * cos(angle), orbit.z * sin(angle + orbit.y), -distance * sin(angle));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        #include <logdepthbuf_vertex>
        gl_PointSize = (1.12 + orbit.w * 1.24) * pixelRatio;
        brightness = orbit.w;
      }
    `,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      varying float brightness;
      void main() {
        #include <logdepthbuf_fragment>
        float fade = 1.0 - smoothstep(0.12, 0.49, length(gl_PointCoord - vec2(0.5)));
        gl_FragColor = vec4(vec3(0.51, 0.53, 0.55), fade * 0.46 * brightness);
      }
    `,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

function referenceLines() {
  const vertices = [];
  for (let i = 0; i < 96; i++) {
    const a = i / 96 * TAU;
    const b = a + TAU / 155;
    const r = 58.2;
    vertices.push(r * Math.cos(a), 0, r * Math.sin(a), r * Math.cos(b), 0, r * Math.sin(b));
    vertices.push((r - 0.15) * Math.cos(a), 0, (r - 0.15) * Math.sin(a),
      (r + (i % 8 === 0 ? 1.2 : 0.25)) * Math.cos(a), 0, (r + (i % 8 === 0 ? 1.2 : 0.25)) * Math.sin(a));
  }
  for (let i = -48; i < 48; i++) {
    vertices.push(i * 1.24, 0, 0, (i + 0.5) * 1.24, 0, 0, 0, 0, i * 1.24, 0, 0, (i + 0.5) * 1.24);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#6c889c', transparent: true, opacity: 0.28 }));
}

const HOME_DIRECTION = new THREE.Vector3(-0.35, 0.67, 0.76).normalize();
const PATH_POINTS = 256;

export class OrbitView {
  constructor(canvas) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(43, 1, 0.05, 1200);
    this.camera.position.copy(HOME_DIRECTION).multiplyScalar(130);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.13;
    this.controls.maxDistance = 270;
    this.controls.minDistance = 6;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.95;
    this.controls.update();
    this.controls.addEventListener('start', () => { this.userMoved = true; });

    this.sky = makeSky();
    this.scene.add(this.sky.group);
    this.scene.add(new THREE.HemisphereLight('#becfff', '#514154', 0.38));
    this.scene.add(new THREE.PointLight('#fff2da', 3.4, 0, 0));
    this.guides = new THREE.Group();
    this.guides.add(referenceLines());
    this.scene.add(this.guides);
    this.dust = makeBeltDust();
    this.scene.add(this.dust);

    this.geometry = new THREE.SphereGeometry(1, 56, 36);
    this.planets = PLANETS.map((body) => this.addPlanet(body));
    this.rockGeometry = new THREE.BufferGeometry();
    this.rockPositions = new Float32Array(44 * 3);
    this.rockGeometry.setAttribute('position', new THREE.BufferAttribute(this.rockPositions, 3).setUsage(THREE.DynamicDrawUsage));
    const rocks = new THREE.Points(this.rockGeometry, new THREE.PointsMaterial({
      color: '#b0a592', size: 1.9, map: glowTexture(), transparent: true, depthWrite: false, opacity: 0.87, sizeAttenuation: false,
    }));
    rocks.frustumCulled = false;
    this.scene.add(rocks);
    this.rocks = rocks;
    this.picks = this.planets.map((entry) => entry.surface);
    this.ray = new THREE.Raycaster();
    this.projected = new THREE.Vector3();
    this.vector = new THREE.Vector3();
    this.cameraTarget = new THREE.Vector3();
    this.cameraOffset = new THREE.Vector3();
    this.lastTarget = new THREE.Vector3();
    this.focused = null;
    this.moveCamera = true;
    this.selected = null;
    this.lastTrace = -Infinity;
  }

  addPlanet(body) {
    const root = new THREE.Group();
    const axis = new THREE.Group();
    axis.rotation.z = body.tilt * Math.PI / 180;
    root.add(axis);
    const texture = makePlanetTexture(body);
    const material = body.id === 'sun' ? new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
      : new THREE.MeshPhongMaterial({ map: texture, specular: body.id === 'earth' ? '#131c23' : '#111218', shininess: 9 });
    const surface = new THREE.Mesh(this.geometry, material);
    surface.scale.setScalar(body.size);
    surface.userData.id = body.id;
    axis.add(surface);
    let atmosphere;
    let rings;
    if (body.atmosphere) {
      atmosphere = planetAtmosphere(body, this.geometry);
      root.add(atmosphere);
    }
    if (body.id === 'saturn') {
      rings = saturnRings(body.size);
      axis.add(rings);
    }
    if (body.id === 'sun') {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture('sun'), color: '#ff873c', opacity: 0.67, toneMapped: false,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.scale.setScalar(20);
      root.add(glow);
    }
    this.scene.add(root);
    let path;
    if (body.elements) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((PATH_POINTS + 1) * 3), 3));
      path = new THREE.Line(geometry, new THREE.LineBasicMaterial({
        color: '#637b94', transparent: true, opacity: 0.49, depthWrite: false,
      }));
      path.frustumCulled = false;
      this.guides.add(path);
    }
    return { body, root, surface, texture, atmosphere, rings, path };
  }

  select(id) {
    if (this.selected === id) return;
    this.selected = id;
    for (const { body, path } of this.planets) {
      if (!path) continue;
      path.material.color.set(body.id === id ? '#b9e7cb' : '#68809b');
      path.material.opacity = body.id === id ? 0.89 : 0.52;
    }
  }

  resize(width, height) {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    if (!this.focused && !this.userMoved) this.moveCamera = true;
  }

  focus(id) {
    this.focused = id;
    this.moveCamera = true;
    this.userMoved = false;
  }

  resetTraces() { this.lastTrace = -Infinity; }

  updateOrbits(states, time) {
    if (time - this.lastTrace < DAY * 25) return;
    this.lastTrace = time;
    const sun = states[0];
    for (let i = 1; i < states.length; i++) {
      const state = states[i];
      const age = this.planets[i];
      const frame = frameFromState(sub(state.position, sun.position), sub(state.velocity, sun.velocity), sun.mu + state.mu);
      if (!frame) continue;
      const points = age.path.geometry.getAttribute('position');
      for (let k = 0; k <= PATH_POINTS; k++) {
        const [x, y, z] = ellipsePoint(frame, TAU * k / PATH_POINTS);
        mapOrbit(x, y, z, this.vector);
        points.setXYZ(k, this.vector.x, this.vector.y, this.vector.z);
      }
      points.needsUpdate = true;
    }
  }

  updateCamera() {
    const focus = this.focused ? this.planets.find(({ body }) => body.id === this.focused) : null;
    if (focus) this.cameraTarget.copy(focus.root.position);
    else this.cameraTarget.set(0, 0, 0);
    if (this.moveCamera) {
      const fit = Math.max(1, 1.20 / this.camera.aspect);
      const distance = focus ? (focus.body.id === 'saturn' ? 11.5 : 9.2) * focus.body.size * Math.min(fit, 1.6)
        : 133 * Math.min(fit, 2.46);
      if (focus && focus.body.id !== 'sun') {
        this.cameraOffset.copy(this.cameraTarget).normalize().multiplyScalar(-0.79).add(new THREE.Vector3(0.12, 0.32, 0.53)).normalize();
      } else this.cameraOffset.copy(HOME_DIRECTION);
      this.controls.target.copy(this.cameraTarget);
      this.camera.position.copy(this.cameraOffset).multiplyScalar(distance).add(this.cameraTarget);
      this.controls.minDistance = focus ? focus.body.size * (focus.body.id === 'saturn' ? 2.7 : 1.45) : 4;
      this.controls.maxDistance = Math.max(290, distance * 1.2);
      this.moveCamera = false;
    } else if (focus) {
      this.camera.position.add(this.vector.copy(this.cameraTarget).sub(this.lastTarget));
      this.controls.target.add(this.vector);
    }
    this.lastTarget.copy(this.cameraTarget);
    this.controls.update();
    this.camera.updateMatrixWorld();
  }

  update(states, time, belt, integratorTime, pixelRatio, showPaths) {
    const sun = states[0].position;
    for (let i = 0; i < states.length; i++) {
      const { body, root, atmosphere, rings, surface } = this.planets[i];
      const { position } = states[i];
      mapOrbit(position[0] - sun[0], position[1] - sun[1], position[2] - sun[2], root.position);
      surface.rotation.y = (body.seed + time / (DAY * body.day)) % 1 * TAU;
      this.vector.copy(root.position).normalize().negate();
      if (atmosphere) atmosphere.material.uniforms.sunDirection.value.copy(this.vector);
      if (rings) rings.material.uniforms.sunDirection.value.copy(this.vector);
    }
    this.guides.visible = showPaths;
    if (showPaths) this.updateOrbits(states, time);
    this.dust.material.uniforms.years.value = time / (365.25 * DAY);
    this.dust.material.uniforms.pixelRatio.value = pixelRatio;
    const alpha = integratorTime === 0 ? 0 : 1 - (integratorTime - time) / ORBIT_STEP;
    let count = 0;
    for (const rock of belt.rocks) {
      if (rock.removed) continue;
      const j = count++ * 3;
      mapOrbit(mix(rock.previous[0], rock.position[0], alpha) - sun[0], mix(rock.previous[1], rock.position[1], alpha) - sun[1],
        mix(rock.previous[2], rock.position[2], alpha) - sun[2], this.vector);
      this.rockPositions[j] = this.vector.x;
      this.rockPositions[j + 1] = this.vector.y;
      this.rockPositions[j + 2] = this.vector.z;
    }
    this.rockGeometry.setDrawRange(0, count);
    this.rockGeometry.getAttribute('position').needsUpdate = true;
    this.updateCamera();
    this.sky.update(this.camera, pixelRatio);
  }

  pick(x, y) {
    this.ray.setFromCamera({ x, y }, this.camera);
    return this.ray.intersectObjects(this.picks)[0]?.object.userData.id;
  }

  project(index, width, height) {
    this.projected.copy(this.planets[index].root.position).project(this.camera);
    return [(this.projected.x + 1) * width / 2, (1 - this.projected.y) * height / 2,
      this.projected.z > -1 && this.projected.z < 1];
  }
}
