import * as THREE from 'three';
import { clamp, mix, smoothstep, TAU } from '../physics/math.js';

function hash(x, y, z, seed) {
  let bits = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(z, 0xb5297a4d) ^ seed;
  bits = Math.imul(bits ^ (bits >>> 15), 0x7feb352d);
  return ((bits ^ (bits >>> 16)) >>> 0) / 4294967296;
}

export function noise3(x, y, z, seed) {
  const a = Math.floor(x), b = Math.floor(y), c = Math.floor(z);
  const px = x - a, py = y - b, pz = z - c;
  const u = px * px * (3 - 2 * px), v = py * py * (3 - 2 * py), w = pz * pz * (3 - 2 * pz);
  return mix(mix(mix(hash(a, b, c, seed), hash(a + 1, b, c, seed), u),
    mix(hash(a, b + 1, c, seed), hash(a + 1, b + 1, c, seed), u), v),
  mix(mix(hash(a, b, c + 1, seed), hash(a + 1, b, c + 1, seed), u),
    mix(hash(a, b + 1, c + 1, seed), hash(a + 1, b + 1, c + 1, seed), u), v), w);
}

export function fbm(x, y, z, seed, octaves = 4) {
  let value = 0;
  let weight = 0.55;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    value += weight * noise3(x, y, z, seed + i * 107);
    total += weight;
    x *= 2.08;
    y *= 2.08;
    z *= 2.08;
    weight *= 0.49;
  }
  return value / total;
}

const color = (hex) => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
const palette = (...hex) => hex.map(color);
const blend = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
function gradient(colors, value) {
  const index = clamp(value, 0, 1) * (colors.length - 1);
  const from = Math.min(Math.floor(index), colors.length - 2);
  return blend(colors[from], colors[from + 1], index - from);
}

const PALETTES = {
  sun: palette('9e2d0a', 'de5f14', 'ff9228', 'ffc75d', 'fff0ae'),
  mercury: palette('383333', '615850', '8a827b', 'c8bdab'),
  venus: palette('876653', 'b29163', 'e7c487', 'fff5d3'),
  mars: palette('4d2823', '91503b', 'bf7554', 'e29e74', 'f0cb9f'),
  jupiter: palette('795653', 'ad7761', 'd3a483', 'ebcca6', 'f3e4cd'),
  saturn: palette('8e775f', 'b5a07b', 'd8be8d', 'f6deb1', 'f7e8cb'),
  uranus: palette('679e9d', '83b9bc', 'a4d4cf', 'c2e8db'),
  neptune: palette('2e4b99', '3f65bc', '648bd4', 'a2bdee'),
  soil: palette('343f29', '4f6638', '82904a', 'bba264', 'd2c3a0'),
  ocean: palette('071832', '102e50', '194b73', '428d98'),
};
const ICE = color('e5e4de');
const CLOUD = color('eef1ec');
const STORM = color('aa604c');

function globeFeatures(seed, count) {
  const golden = 2.399963229728653;
  return Array.from({ length: count }, (_, index) => {
    const y = 1 - 2 * (index + 0.5) / count;
    const angle = seed + index * golden;
    const radius = Math.sqrt(1 - y * y);
    return [-Math.cos(angle) * radius, y, Math.sin(angle) * radius, 0.014 + 0.026 * hash(index, 0, 0, seed) ** 2];
  });
}

const CONTINENTS = [
  [0.15, 0.55, 0.48], [0.20, 0.44, 0.32], [0.31, 0.36, 0.29], [0.35, 0.28, 0.24],
  [0.49, 0.59, 0.28], [0.55, 0.46, 0.34], [0.56, 0.36, 0.30], [0.64, 0.55, 0.41],
  [0.75, 0.55, 0.49], [0.81, 0.45, 0.25], [0.87, 0.31, 0.29], [0.38, 0.75, 0.19],
].map(([u, v, radius]) => {
  const latitude = Math.PI * (v - 0.5);
  return [-Math.cos(TAU * u) * Math.cos(latitude), Math.sin(latitude), Math.sin(TAU * u) * Math.cos(latitude), radius];
});

function surface(body, x, y, z, u, v, craters) {
  const { id, seed } = body;
  const absoluteLatitude = Math.abs(y);
  const base = fbm(x * 4.6, y * 4.6, z * 4.6, seed);
  const grain = noise3(x * 95, y * 95, z * 95, seed + 61);
  if (id === 'sun') {
    const cells = noise3(x * 91.9, y * 91.9, z * 91.9, seed);
    const channels = Math.abs(noise3(x * 38, y * 38, z * 38, seed + 5) - 0.52);
    return gradient(PALETTES.sun, 0.28 + 0.53 * base + 0.22 * cells + 0.14 * channels);
  }
  if (id === 'earth') {
    let territory = -1;
    for (const [a, b, c, radius] of CONTINENTS) territory = Math.max(territory, x * a + y * b + z * c - Math.cos(radius));
    territory += (base - 0.51) * 0.27 + (grain - 0.5) * 0.007;
    const ocean = gradient(PALETTES.ocean, 0.42 + smoothstep(-0.055, -0.001, territory) * 0.53 + (base - 0.5) * 0.3);
    const dry = 0.36 * Math.exp(-(((absoluteLatitude - 0.43) * 5) ** 2)) + 0.53 * base;
    const land = gradient(PALETTES.soil, dry + 0.14 * (grain - 0.5));
    let rgb = blend(ocean, land, smoothstep(-0.003, 0.005, territory));
    rgb = blend(rgb, ICE, smoothstep(0.86, 0.98, absoluteLatitude + (base - 0.5) * 0.24));
    const weather = fbm(x * 7 + z * 2.9, y * 11.5, z * 7 - x * 1.6, 934, 4);
    return blend(rgb, CLOUD, 0.77 * smoothstep(0.51, 0.77, weather + 0.18 * (base - 0.5)));
  }
  if (id === 'mercury' || id === 'mars') {
    let impacts = 0;
    for (const [a, b, c, width] of craters) {
      const d = 1 - (a * x + b * y + c * z);
      if (d > width * 1.16) continue;
      const r = Math.sqrt(Math.max(0, d / width));
      const rim = Math.max(0, 1 - Math.abs(r - 0.87) / 0.16);
      impacts += 0.11 * rim - 0.075 * (1 - smoothstep(0.34, 0.78, r));
    }
    const strata = fbm(x * 15.2, y * 15.2, z * 15.2, seed + 178, 3);
    const rgb = gradient(PALETTES[id], 0.13 + 0.59 * base + 0.21 * strata + 0.14 * grain + impacts);
    return id === 'mars' ? blend(rgb, color('edd0ae'), smoothstep(0.955, 0.998, absoluteLatitude + 0.03 * (base - 0.5))) : rgb;
  }
  const wind = fbm(x * 4, y * 16.4, z * 4, seed + 155, 3);
  const latitude = y + 0.037 * (wind - 0.5);
  if (id === 'venus') {
    const waves = Math.sin(21 * latitude + 3.6 * wind + 5 * base);
    return gradient(PALETTES.venus, 0.49 + 0.38 * base + 0.2 * waves * (0.5 + wind));
  }
  const banding = (Math.sin(latitude * 68 + 1.55 * wind) + 0.61 * Math.sin(latitude * 26 - 2 * wind)
    + 0.34 * Math.sin(latitude * 161 + 4 * wind)) / 1.95;
  const contrast = id === 'jupiter' ? 0.36 : id === 'saturn' ? 0.21 : 0.10;
  let rgb = gradient(PALETTES[id], 0.42 + 0.22 * (wind - 0.5) + banding * contrast + 0.16 * base
    + (id === 'uranus' ? 0.13 * absoluteLatitude : -0.1 * absoluteLatitude));
  if (id === 'jupiter') {
    const oval = Math.hypot((u - 0.64) * 31.6, (v - 0.37) * 44.5);
    const flow = Math.sin(oval * 13 + 7 * wind);
    rgb = blend(rgb, STORM, (1 - smoothstep(0.55, 1.04, oval)) * (0.63 + 0.23 * flow));
  }
  return rgb;
}

export function makePlanetTexture(body) {
  const width = body.id === 'earth' ? 768 : 512;
  const height = width / 2;
  const data = new Uint8Array(width * height * 4);
  const craters = globeFeatures(body.seed, body.id === 'mercury' ? 41 : body.id === 'mars' ? 25 : 0);
  const longitudes = Array.from({ length: width }, (_, i) => [-Math.cos(TAU * i / width), Math.sin(TAU * i / width)]);
  for (let j = 0; j < height; j++) {
    const v = (j + 0.5) / height;
    const latitude = Math.PI * (v - 0.5);
    const y = Math.sin(latitude);
    const radius = Math.cos(latitude);
    for (let i = 0; i < width; i++) {
      const [a, b] = longitudes[i];
      const rgb = surface(body, a * radius, y, b * radius, i / width, v, craters);
      const index = 4 * (j * width + i);
      data[index] = rgb[0];
      data[index + 1] = rgb[1];
      data[index + 2] = rgb[2];
      data[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function paintPlanet(canvas, texture, body) {
  const context = canvas.getContext('2d');
  const { data, width, height } = texture.image;
  const size = canvas.width;
  const image = context.createImageData(size, size);
  const radius = size * (body.id === 'saturn' ? 0.29 : 0.419);
  function drawRing(back) {
    if (body.id !== 'saturn') return;
    context.save();
    context.translate(size / 2, size / 2);
    context.rotate(-0.29);
    context.scale(1, 0.27);
    for (let k = 0; k < 16; k++) {
      if (k === 10 || k === 11) continue;
      context.strokeStyle = `rgba(211,183,136,${0.32 + (Math.cos(k * 0.62) + 1) * 0.23})`;
      context.lineWidth = 1.8;
      context.beginPath();
      context.arc(0, 0, radius * (1.22 + k * 0.047), back ? Math.PI : 0, back ? TAU : Math.PI);
      context.stroke();
    }
    context.restore();
  }
  context.clearRect(0, 0, size, size);
  drawRing(true);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5 - size / 2) / radius;
      const y = (size / 2 - j - 0.5) / radius;
      const distance = Math.hypot(x, y);
      if (distance >= 1.013) continue;
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      const longitude = (Math.atan2(z, -x) / TAU + (body.id === 'earth' ? 0.09 : 0.35) + 1) % 1;
      const latitude = 0.5 + Math.asin(clamp(y, -1, 1)) / Math.PI;
      const sample = 4 * (Math.min(height - 1, Math.floor(latitude * height)) * width + Math.floor(longitude * width));
      const illumination = Math.max(0, -0.62 * x + 0.46 * y + z * 0.68);
      const factor = body.id === 'sun' ? 1.05 : 0.085 + 0.99 * illumination ** 0.68;
      const pixel = 4 * (j * size + i);
      for (let k = 0; k < 3; k++) image.data[pixel + k] = data[sample + k] * factor;
      image.data[pixel + 3] = 255 * (1 - smoothstep(0.986, 1.013, distance));
    }
  }
  const disk = document.createElement('canvas');
  disk.width = disk.height = size;
  disk.getContext('2d').putImageData(image, 0, 0);
  context.drawImage(disk, 0, 0);
  drawRing(false);
}

const spriteTextures = new Map();
export function glowTexture(falloff = 'soft') {
  if (spriteTextures.has(falloff)) return spriteTextures.get(falloff);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const ring = ctx.createRadialGradient(64, 64, falloff === 'sun' ? 12 : 0, 64, 64, 63);
  ring.addColorStop(0, 'rgba(255,255,255,1)');
  ring.addColorStop(0.22, 'rgba(255,255,255,0.58)');
  ring.addColorStop(0.59, 'rgba(255,255,255,0.105)');
  ring.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = ring;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  spriteTextures.set(falloff, texture);
  return texture;
}
