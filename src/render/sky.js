import * as THREE from 'three';
import { random, TAU } from '../physics/math.js';

export function makeSky({ radius = 600, mars = false } = {}) {
  const group = new THREE.Group();
  const horizon = { value: mars ? 0.8 : 0 };
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      atmosphere: horizon,
      sun: { value: new THREE.Vector3(-0.64, 0.29, -0.68).normalize() },
    },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }
    `,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      varying vec3 direction;
      uniform float atmosphere;
      uniform vec3 sun;
      void main() {
        #include <logdepthbuf_fragment>
        vec3 view = normalize(direction);
        float band = exp(-pow(abs(dot(view, normalize(vec3(0.42, 0.87, 0.3)))) * 5.0, 2.0));
        vec3 space = vec3(0.0024, 0.0037, 0.0083) + band * vec3(0.0039, 0.0067, 0.011);
        float horizonLight = exp(-max(0.0, view.y + 0.018) * 5.7);
        float sunlight = pow(max(0.0, dot(view, sun)), 10.0);
        vec3 dusk = mix(vec3(0.045, 0.024, 0.022), vec3(0.52, 0.219, 0.105), horizonLight);
        dusk += sunlight * vec3(0.31, 0.19, 0.14);
        gl_FragColor = vec4(mix(space, dusk, atmosphere), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 20), material);
  dome.renderOrder = -20;
  dome.frustumCulled = false;
  group.add(dome);

  const next = random(17705);
  const count = mars ? 1600 : 4050;
  const points = new Float32Array(count * 3);
  const properties = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const y = 2 * next() - 1;
    const ring = Math.sqrt(1 - y * y);
    const azimuth = TAU * next();
    points.set([Math.cos(azimuth) * ring * radius * 0.94, y * radius * 0.94, Math.sin(azimuth) * ring * radius * 0.94], i * 3);
    const rank = next();
    properties.set([1 + (rank ** 11) * 2.25, 0.145 + 0.77 * rank ** 3, next()], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  geometry.setAttribute('properties', new THREE.BufferAttribute(properties, 3));
  const starMaterial = new THREE.ShaderMaterial({
    uniforms: { atmosphere: horizon, pixelRatio: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 properties;
      varying vec2 brightness;
      uniform float pixelRatio;
      void main() {
        brightness = properties.yz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
        gl_PointSize = properties.x * pixelRatio;
      }
    `,
    fragmentShader: `
      #include <logdepthbuf_pars_fragment>
      varying vec2 brightness;
      uniform float atmosphere;
      void main() {
        #include <logdepthbuf_fragment>
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        float alpha = (1.0 - smoothstep(0.08, 1.0, radius)) * brightness.x * (1.0 - atmosphere);
        vec3 color = mix(vec3(0.53, 0.73, 1.0), vec3(1.0, 0.81, 0.64), brightness.y);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  const stars = new THREE.Points(geometry, starMaterial);
  stars.renderOrder = -19;
  stars.frustumCulled = false;
  group.add(stars);
  return {
    group,
    update(camera, pixelRatio, haziness = 0) {
      group.position.copy(camera.position);
      horizon.value = haziness;
      starMaterial.uniforms.pixelRatio.value = pixelRatio;
    },
  };
}
