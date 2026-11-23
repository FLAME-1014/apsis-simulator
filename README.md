# Apsis

在线演示：https://flame-1014.github.io/apsis-simulator/

Apsis is a local, interactive 3D solar-system and spacecraft-flight simulator. It runs entirely in a browser, needs no account or remote API, and includes a procedural solar-system observatory, a high-speed asteroid-collision experiment and a steerable Mars lander.

## Start

Use Node.js 22.13 or later (Node 24 LTS is recommended). In a terminal opened in this directory:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. To create and serve a production build, run `npm run build` followed by `npm run preview`.

## Use the simulator

- **Observatory:** Select a body from the catalog or click its label. Click **Focus on Mars** to track its real integrated position. Drag to rotate; scroll or pinch to zoom. Adjust the play speed or pause and step one simulated hour at a time.
- **Asteroid lab:** Compare head-on, glancing and near-miss trajectories. Adjust the coefficient of restitution before running the experiment; watch the velocity readouts, impact marker and retained kinetic energy update as the rocks collide.
- **Mars mission:** Fly the approach yourself using **Space** for engine thrust, **WASD** for lateral RCS and **Shift** for sideways braking. Engage guidance to observe a complete powered descent. The guidance does not prevent manual control. Choose **Practice final descent** to begin near the landing site, and **Overhead** when a downward camera view helps. Touch down inside the zone at no more than 5 m/s along the local ground normal, 4 m/s across the ground or 12° slope.
- **Mobile:** Pinch or drag the view and hold the on-screen thrust controls.
- Press **P** to play or pause. Use **Controls & display** in the header to set automatic, high or low render resolution.

## Physics model

### Solar-system initialization

Positions, dates, masses and distances use the following units:

| Quantity | Units |
| --- | --- |
| Position and radius | km |
| Velocity | km/s |
| Time | seconds since J2000 |
| Gravitational parameter, μ = GM | km³/s² |

Each planet's six starting orbital elements (semimajor axis *a*, eccentricity *e*, inclination *i*, mean longitude, longitude of perihelion and ascending node) are J2000 values. The Sun and each planet's tabulated μ initialize a Cartesian position and velocity from Kepler's equation, **M = E − e sin(E)**. The Sun's μ and the planet's μ are included in each initial two-body element conversion. The initial nine-body frame is translated and boosted to zero center-of-mass position and velocity. Earth's gravity source includes the Moon's mass, while the surface-gravity readout uses Earth's own μ.

From the reference epoch forward, all nine massive bodies evolve together. For body *i*, the simulator computes the direct pairwise Newtonian acceleration

```
aᵢ = Σⱼ≠ᵢ μⱼ · (rⱼ − rᵢ) / |rⱼ − rᵢ|³
```

using kick–drift–kick (velocity-Verlet/leapfrog) integration with a **fixed one-hour step** and no softened solar force. This time-symmetric, symplectic integrator is second-order accurate: its energy error typically remains bounded, and numerical trajectory error decreases quadratically with the step size. The solar-system display uses cubic Hermite interpolation between integration states, avoiding visible one-hour jumps. A bounded per-frame integration budget prevents the requested playback speed from causing an unbounded pause; exceptionally fast playback slows down internally instead of taking unstable large time steps. Body positions and telemetry read from the propagated states. The drawn orbit guides show instantaneous osculating ellipses, refreshed every 25 simulated days; they are not predictions of the full perturbed trajectory.

The seeded main-belt display contains 3,100 lightweight, shader-animated representative particles. Separately, 44 seeded asteroids feel the time-dependent gravity of the Sun and all eight planets, can collide with each other, and are removed if swept into a planet. They are test particles: they do not change planetary orbits or exert mutual gravity. The interactive impact lab uses two three-dimensional, finite-radius spheres with constant-density masses; its irregular surface meshes sit within their collision bounds, shown by the **Bounds** toggle. During a drift, a relative-motion quadratic calculates the **first time of impact**, even if the objects would cross between frames. A frictionless Newton restitution impulse conserves pair momentum, dissipates the selected amount of normal kinetic energy and corrects overlaps. Planetary impacts are absorbed. Chronological event resolution processes the remaining time after an impact, including additional contacts. An event budget bounds work in unusually dense contact configurations.

### Mars flight and terrain contact

One scene unit in flight mode is **one metre**. The mission begins at an inbound Mars approach checkpoint, 106 km above the local surface with a 920 m/s downward velocity, or at a 235 m practice checkpoint. The Mars gravity parameter and 3,389.5 km mean radius define a spherical inverse-square gravity field. A **60 Hz velocity-Verlet integrator** updates thrust and gravity. Propellant decreases at `thrust / exhaustVelocity` kg/s, and acceleration uses the changing wet mass. The main engine and lateral RCS share the 420 kN thrust limit and an effective 3,200 m/s exhaust velocity. High time compression automatically reduces near terrain, but the fixed physics step remains 1/60 s.

The landing site terrain is seeded procedural elevation, composed of basin relief, overlapping noise scales and craters on a spherical planet. Seven nested square tile levels cover approximately 2,097 km of local ground; the inner levels resolve the landing site to four-metre cells. The meshes are built once. Their adjoining vertices share the coarse surface's linearly interpolated edge heights, so the rendered meshes and collision surface agree across level boundaries. An inset globe closes the far planetary silhouette beyond the local terrain. Leaving the supported flight region ends the attempt.

At every physics step, the flight system sweeps **52 contact points**: each foot's center and all 16 bottom-edge vertices, plus the central engine-bell point. It tests their movement against the same two ground triangles rendered in each terrain cell and selects the earliest contact within the step. Checking the foot perimeter prevents a sloping surface from cutting through an otherwise supported footpad. Touchdown height, slope and velocity are measured against that triangle's actual surface normal. A safe impact outside the marked pad is reported separately from a crash or a landing inside the pad. The lander stops at first contact; rigid-body tumbling, gear compression and post-impact settling are outside this model.

### What is deliberately simplified

The semimajor axes, initial osculating elements and planet μ values are physical. The observatory's radial display mapping is `11 × ln(1 + 3.65 × distanceAU)`; planet radii are enlarged independently. The simulation itself always uses physical distances. The Sun and planets are point masses for orbital acceleration. Moons, general relativity, tidal effects and gravitational harmonics are omitted. This is an educational simulation, not a precision ephemeris. Planet textures, terrain, stars and atmosphere effects are generated locally. Shader atmospheres use a view-dependent illuminated rim rather than a full physical scattering calculation. Flight uses a separate Mars-relative frame and a fixed upright attitude; it does not model an interplanetary transfer, aerodynamic heating, wind or structural damage.

## Development and checks

```sh
npm test
npm run lint
npm run build
npm run test:browser
npm run test:performance
npm run verify:long
npm run test:soak
```

The physics and geometry suite has **98 tests** covering orbital elements and Kepler's equation, leapfrog convergence and conservation, high-speed sphere impacts, momentum and restitution, deterministic procedural terrain, tile joins, exact contact sweeps, footpad support, landing limits, fuel and both complete powered touchdown profiles. Independent Three.js raycasts compare the collision surface with the actual rendered mesh. Time tests check identical physics at 30, 60 and 144 rendered frames per second.

The production-browser suite uses Playwright to exercise all three modes and the 390 px touch layout. It captures verification images in the ignored `artifacts/` directory. On Windows it uses installed Google Chrome; elsewhere it uses Playwright Chromium (`npx playwright install chromium` if needed). Override the channel with `APSIS_BROWSER_CHANNEL=msedge` or `APSIS_BROWSER_CHANNEL=default` for the bundled browser. `APSIS_ANGLE=swiftshader` selects software rendering for debugging; use hardware acceleration for meaningful performance measurements.

`npm run test:performance` warms and measures four live workloads at 1440 × 900: normal and maximum orbit playback, the impact lab, and a Mars descent below 95 m with real terrain shadows. The available integrated AMD Radeon GPU and Ryzen 7 5700G sustained approximately **59.94 fps**, with a **16.8 ms 95th-percentile frame interval** in all four workloads. CPU submission and simulation took at most 1.8 ms at the 95th percentile in this run. The test report records its hardware, browser version, render resolution, frame intervals and scene draw counts in `artifacts/performance.json`. This is measured local hardware evidence, not a guarantee for every laptop. Automatic resolution scaling and a low-resolution option support slower machines.

`npm run verify:long` integrates **1,000 years** in 8,766,000 fixed steps. The completed run retained bound orbits for all eight planets, with a terminal relative total-energy error of **2.37 × 10⁻¹⁰** and relative angular-momentum error of **1.27 × 10⁻¹³**. Conservation is audited every simulated day; the largest sampled relative energy error was **4.63 × 10⁻⁹**, demonstrating bounded numerical error across the run. These refer to the model's conserved quantities, not agreement with the real solar system over a millennium. `node scripts/long-run.mjs 100` runs a shorter century. It saves the report to `artifacts/long-run.json`. This is a numerical validation workload; the UI does not perform it in one frame.

`npm run test:soak` runs accelerated WebGL playback for 60 simulated years and checks orbit validity, browser errors and stable GPU geometry/texture counts every 30 real seconds. It takes approximately six real minutes and writes `artifacts/ui-soak.json`. Use `node scripts/browser-soak.mjs 10` after building for a shorter run.

## Code layout

| Directory | Responsibility |
| --- | --- |
| `src/physics/` | Pure numerical orbits, gravity, collisions, terrain, flight and clocks |
| `src/render/` | Three.js scenes, shader atmospheres, procedural textures, terrain meshes and adaptive rendering |
| `src/ui/` | DOM formatting and projected labels |
| `src/main.js` | Input, independent mode sessions, time controls and animation loop |
| `test/` | Node test runner suites, including independent mesh raycasts |
| `scripts/` | Production browser acceptance, performance, endurance and millennial validation |

## Reference data

- JPL Solar System Dynamics, [approximate positions of the planets](https://ssd.jpl.nasa.gov/planets/approx_pos.html): initial J2000 orbital elements.
- JPL Solar System Dynamics, [planetary physical parameters](https://ssd.jpl.nasa.gov/planets/phys_par.html) and [astrodynamic parameters](https://ssd.jpl.nasa.gov/astro_par.html): gravity parameters and mean radii.
- Three.js supplies rendering and camera controls. Fontsource supplies locally bundled fonts. No external textures or hosted font service are used at runtime.
