export const AU = 149_597_870.7;
export const DAY = 86_400;
export const YEAR = 365.25 * DAY;
export const EPOCH = Date.UTC(2000, 0, 1, 12);

// JPL approximate elements at J2000. Order: a [AU], e, i, L, ϖ, Ω [degrees].
// Positions and velocities derived from these elements are integrated thereafter.
export const PLANETS = [
  { id: 'sun', name: 'Sun', kind: 'G-type star', number: '☉', mu: 132_712_440_041.9394, radius: 695_700,
    day: 25.38, tilt: 7.25, size: 2.95, color: '#ffbd71', seed: 50,
    description: 'The Sun holds nearly all the mass in the solar system. Its gravity governs the orbits you see here.' },
  { id: 'mercury', name: 'Mercury', kind: 'Rocky planet', number: '01', mu: 22_031.86855, radius: 2439.7,
    day: 58.646, tilt: 0.03, size: 0.46, color: '#a8a39d', seed: 23,
    elements: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
    description: 'Mercury follows the most eccentric orbit of the eight planets. Its airless surface preserves impact craters.' },
  { id: 'venus', name: 'Venus', kind: 'Rocky planet', number: '02', mu: 324_858.592, radius: 6051.8,
    day: 243.025, tilt: 177.36, size: 0.72, color: '#ead3a5', seed: 402,
    atmosphere: ['#ffd098', 1.036, 0.75],
    elements: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
    description: 'A thick carbon dioxide atmosphere hides Venus’s surface beneath bright sulfuric acid clouds.' },
  { id: 'earth', name: 'Earth', kind: 'Rocky planet', number: '03', mu: 403_503.2355, surfaceMu: 398_600.4355, radius: 6371,
    day: 0.99726968, tilt: 23.44, size: 0.83, color: '#73a8f7', seed: 118,
    atmosphere: ['#59aaff', 1.062, 1.22],
    elements: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    description: 'Almost three quarters of Earth’s surface is covered by oceans. Earth and the Moon share one gravity source in this model.' },
  { id: 'mars', name: 'Mars', kind: 'Rocky planet', number: '04', mu: 42_828.375816, radius: 3389.5,
    day: 1.02595675, tilt: 25.19, size: 0.69, color: '#f09872', seed: 73,
    atmosphere: ['#e99562', 1.045, 0.72],
    elements: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    description: 'Iron-rich dust gives Mars its rust color. Fly an inbound approach to a landing site on its cratered terrain.' },
  { id: 'jupiter', name: 'Jupiter', kind: 'Gas giant', number: '05', mu: 126_712_764.1, radius: 69_911,
    day: 0.41354, tilt: 3.13, size: 2.18, color: '#dfb191', seed: 25,
    atmosphere: ['#f1bc8d', 1.027, 0.4],
    elements: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    description: 'Jupiter is heavier than the other seven planets combined. Fast winds shear its atmosphere into bands.' },
  { id: 'saturn', name: 'Saturn', kind: 'Gas giant', number: '06', mu: 37_940_584.842, radius: 58_232,
    day: 0.444, tilt: 26.73, size: 1.89, color: '#edd49f', seed: 49,
    atmosphere: ['#e8c89b', 1.023, 0.4],
    elements: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    description: 'Ice and rock form Saturn’s broad rings. The Cassini Division is a major gap between its brightest rings.' },
  { id: 'uranus', name: 'Uranus', kind: 'Ice giant', number: '07', mu: 5_794_556.4, radius: 25_362,
    day: 0.71833, tilt: 97.77, size: 1.23, color: '#a2dfdc', seed: 61,
    atmosphere: ['#82efd8', 1.058, 0.58],
    elements: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
    description: 'Uranus rotates on its side. Methane in its atmosphere absorbs red light and gives the planet its pale blue-green color.' },
  { id: 'neptune', name: 'Neptune', kind: 'Ice giant', number: '08', mu: 6_836_527.1, radius: 24_622,
    day: 0.67125, tilt: 28.32, size: 1.18, color: '#7d9df3', seed: 62,
    atmosphere: ['#6595ff', 1.047, 0.75],
    elements: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    description: 'The farthest planet takes about 165 Earth years to orbit. Its atmosphere has some of the fastest winds in the solar system.' },
];

export const MARS = PLANETS.find((body) => body.id === 'mars');
