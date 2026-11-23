# Verification record

Completed locally on 21 November 2026, using the built production application and its numerical modules.

- `npm run lint`: passed with zero warnings or errors.
- `npm test`: all 98 numerical, timing, terrain and contact-geometry tests passed.
- `npm run build`: production assets built successfully. Three.js accounts for most of the 166 kB compressed JavaScript bundle.
- `npm run test:browser`: completed orbit selection and focus, pause plus an exact one-hour step, restitution input, a full asteroid impact, a complete Mars approach and 390 px manual touch flight. No JavaScript, shader or network errors were observed.
- Guided approach touchdown: 201.989 simulated seconds; normal impact speed 2.120 m/s; lateral speed 0.00276 m/s; landing range 0.01684 m; 3,941 kg propellant remaining. The original 106 km altitude checkpoint was used.
- Contact verification: 52 swept support points include every rendered bottom-edge footpad vertex. Tests compared terrain heights and swept intersections against independent Three.js raycasts into the real render mesh, including rough ground and terrain-level boundaries. A deliberate 100 km/s one-frame impact stopped at the first contact.
- `npm run test:performance`: approximately 59.94 fps at 1440 × 900 in all four workloads, including 60 simulated days/second with nine massive bodies and 44 integrated asteroids, and a low Mars approach with shadows. The 95th-percentile frame interval was 16.8 ms. The hardware used an integrated AMD Radeon GPU and AMD Ryzen 7 5700G; measurements do not establish performance on every laptop.
- `npm run verify:long`: all eight planets remained bound after 1,000 simulated years / 8,766,000 fixed integration steps. Terminal relative energy error was 2.366 × 10⁻¹⁰ and terminal relative angular-momentum error was 1.272 × 10⁻¹³. Daily conservation audits found a maximum sampled relative energy error of 4.625 × 10⁻⁹.
- `npm run test:soak`: 390 real seconds of uninterrupted maximum-speed WebGL playback covered 64.09 simulated years. GPU allocation counts stayed at 16 geometries and 11 textures throughout. All checked body states remained finite and elliptically bound. No browser errors were recorded.

Reproducible scripts are in `scripts/`; generated JSON reports and PNG captures are in the ignored `artifacts/` directory. See the README for model assumptions, commands and controls.
