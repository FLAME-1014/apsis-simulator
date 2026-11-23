import { AU, DAY, PLANETS, YEAR } from './planets.js';
import { frameFromState, period } from './orbits.js';
import { norm, sub } from './math.js';

export function inspectPlanet(index, states) {
  const body = PLANETS[index];
  const relative = sub(states[index].position, states[0].position);
  const velocity = sub(states[index].velocity, states[0].velocity);
  if (index === 0) return {
    distanceAU: 0, speedKmS: 0, periodSeconds: null, periodLabel: '—', eccentricity: null,
    radiusKm: body.radius, surfaceGravity: body.mu * 1000 / body.radius ** 2,
  };
  const frame = frameFromState(relative, velocity, states[0].mu + states[index].mu);
  return {
    distanceAU: norm(relative) / AU,
    speedKmS: norm(velocity),
    periodSeconds: frame ? period(frame.a, frame.mu) : null,
    periodLabel: !frame ? '—' : period(frame.a, frame.mu) > 2.4 * YEAR
      ? `${(period(frame.a, frame.mu) / YEAR).toFixed(2)} yr` : `${(period(frame.a, frame.mu) / DAY).toFixed(1)} d`,
    eccentricity: frame?.e ?? null, radiusKm: body.radius,
    surfaceGravity: (body.surfaceMu ?? body.mu) * 1000 / body.radius ** 2,
  };
}

export function telemetrySnapshot({ mode, states, index, time, running, rate }) {
  return {
    mode, running, time,
    speedFactor: rate,
    bodies: states.map((state) => ({
      id: state.id,
      positionKm: [...state.position],
      velocityKmS: [...state.velocity],
    })),
    selected: inspectPlanet(index, states),
  };
}
