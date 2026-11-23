import { AU } from './planets.js';
import { TAU, cross, dot, norm, scale, sub, wrap } from './math.js';

const RAD = Math.PI / 180;

/** Solve M = E - e sin(E) for an elliptical orbit. The bracket guards Newton near e = 1. */
export function eccentricAnomaly(mean, e) {
  if (!(e >= 0 && e < 1)) throw new RangeError('An elliptical orbit requires 0 ≤ e < 1');
  const m = wrap(mean);
  let lo = -Math.PI;
  let hi = Math.PI;
  let angle = e < 0.8 ? m : Math.sign(m) * Math.PI * 0.85;
  for (let i = 0; i < 56; i++) {
    const residual = angle - e * Math.sin(angle) - m;
    if (Math.abs(residual) < 2e-14) return angle;
    if (residual > 0) hi = angle;
    else lo = angle;
    const next = angle - residual / (1 - e * Math.cos(angle));
    angle = next > lo && next < hi ? next : 0.5 * (lo + hi);
  }
  return angle;
}

export function frameFromJpl([a, e, inclination, longitude, perihelion, node], mu) {
  const i = inclination * RAD;
  const omega = (perihelion - node) * RAD;
  const capitalOmega = node * RAD;
  const ci = Math.cos(i);
  const si = Math.sin(i);
  const cw = Math.cos(omega);
  const sw = Math.sin(omega);
  const cO = Math.cos(capitalOmega);
  const sO = Math.sin(capitalOmega);
  // Ecliptic (X, Y, Z) -> scene (X, Z, -Y), a proper rotation with +Y north.
  return {
    a: a * AU, e, mean: (longitude - perihelion) * RAD, mu,
    p: [cO * cw - sO * sw * ci, sw * si, -(sO * cw + cO * sw * ci)],
    q: [-cO * sw - sO * cw * ci, cw * si, sO * sw - cO * cw * ci],
  };
}

export function period(a, mu) {
  return TAU * Math.sqrt(a ** 3 / mu);
}

export function ellipsePoint(frame, anomaly) {
  const x = frame.a * (Math.cos(anomaly) - frame.e);
  const y = frame.a * Math.sqrt(1 - frame.e ** 2) * Math.sin(anomaly);
  return frame.p.map((p, i) => p * x + frame.q[i] * y);
}

export function stateOnEllipse(frame, seconds = 0) {
  const n = Math.sqrt(frame.mu / frame.a ** 3);
  const anomaly = eccentricAnomaly(frame.mean + n * seconds, frame.e);
  const factor = frame.a * n / (1 - frame.e * Math.cos(anomaly));
  const dx = -Math.sin(anomaly) * factor;
  const dy = Math.sqrt(1 - frame.e ** 2) * Math.cos(anomaly) * factor;
  return {
    position: ellipsePoint(frame, anomaly),
    velocity: frame.p.map((p, i) => p * dx + frame.q[i] * dy),
  };
}

/** Instantaneous osculating ellipse. Open and degenerate trajectories have no ellipse. */
export function frameFromState(position, velocity, mu) {
  const r = norm(position);
  const angularMomentum = cross(position, velocity);
  const h = norm(angularMomentum);
  const energy = dot(velocity, velocity) / 2 - mu / r;
  if (!(energy < 0 && h > 0)) return null;
  const a = -mu / (2 * energy);
  const eccentricity = sub(scale(cross(velocity, angularMomentum), 1 / mu), scale(position, 1 / r));
  const e = norm(eccentricity);
  if (e >= 1) return null;
  const p = e > 1e-10 ? scale(eccentricity, 1 / e) : scale(position, 1 / r);
  const q = cross(scale(angularMomentum, 1 / h), p);
  const anomaly = Math.atan2(dot(position, q) / (a * Math.sqrt(1 - e ** 2)), dot(position, p) / a + e);
  return { a, e, p, q, mean: anomaly - e * Math.sin(anomaly), mu };
}
