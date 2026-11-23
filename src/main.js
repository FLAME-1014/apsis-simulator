import * as THREE from 'three';
import { DAY, EPOCH, PLANETS } from './physics/planets.js';
import { ORBIT_STEP, SolarTimeline } from './physics/solar-system.js';
import { BeltDynamics, ImpactLab, TRIALS, rockEnergy } from './physics/asteroids.js';
import { FLIGHT_STEP, MarsFlight, allowedFlightRate, phaseForAltitude } from './physics/flight.js';
import { FixedClock } from './physics/clock.js';
import { clamp, norm, sub } from './physics/math.js';
import { OrbitView } from './render/orbit-view.js';
import { ImpactView } from './render/impact-view.js';
import { FlightView } from './render/flight-view.js';
import { FramePacing } from './render/frame-pacing.js';
import { inspectPlanet, telemetrySnapshot } from './physics/telemetry.js';
import { paintPlanet } from './render/textures.js';
import { $, buttonLabel, dateParts, distance, integer, pressed, showProjected, speed, text, timeDisplay } from './ui/dom.js';
import './style.css';

const solarSpeeds = [[1, '1 s/s', '1 second'], [60, '1 min/s', '1 minute'], [3600, '1 h/s', '1 hour'],
  [DAY, '1 day/s', '1 day'], [10 * DAY, '10 days/s', '10 days'], [60 * DAY, '60 days/s', '60 days']];
const rates = {
  orbit: solarSpeeds,
  impact: [0.25, 1, 2, 5].map((rate) => [rate, `${rate}×`, `${rate} times real time`]),
  flight: [1, 2, 4, 8].map((rate) => [rate, `${rate}×`, `${rate} times real time`]),
};
const viewTitles = {
  orbit: ['Sun-centered view', 'Solar system'], impact: ['Asteroid collision', 'Impact lab'], flight: ['Mars surface approach', 'Landing mission'],
};
const trialNotes = {
  direct: 'The rocks collide along the same line. Watch how their different masses affect the rebound.',
  grazing: 'The rocks strike off-center and deflect sideways. Their trails show the change in direction.',
  miss: 'The rocks pass just outside their combined radii and continue without exchanging momentum.',
};

function boot() {
  const canvas = $('simulation-canvas');
  const stage = $('stage');
  const views = {};
  const clocks = { impact: new FixedClock(1 / 60, 60), flight: new FixedClock(FLIGHT_STEP, 75) };
  const sessions = {
    orbit: { running: true, rate: 3, paths: true, labels: true },
    impact: { running: false, rate: 1, paths: true, labels: true },
    flight: { running: false, rate: 0, paths: true, labels: true },
  };
  const catalog = [];
  const labels = [];
  const modeButtons = [...document.querySelectorAll('.mode-tabs [data-mode]')];
  const panels = [...document.querySelectorAll('[data-panel]')];
  const stagePanels = [...document.querySelectorAll('[data-stage]')];
  const plan = [...document.querySelectorAll('#flight-plan li')];
  const trialButtons = [...document.querySelectorAll('[data-trial]')];
  const contacts = $('touch-controls');
  const keys = new Set();
  const pointers = new Map();
  let selected = 4;
  let mode = 'orbit';
  let width = 1;
  let height = 1;
  let lastFrame;
  let lastTelemetry = -Infinity;
  let contextLost = false;
  let renderNeeded = true;
  let gl;

  try {
    gl = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
  } catch (error) {
    $('view-error').textContent = 'WebGL 2 is unavailable. Enable hardware acceleration or open the simulator in a browser that supports WebGL 2.';
    console.error(error);
    return;
  }
  gl.outputColorSpace = THREE.SRGBColorSpace;
  gl.toneMapping = THREE.ACESFilmicToneMapping;
  gl.toneMappingExposure = 1.11;
  gl.shadowMap.type = THREE.PCFShadowMap;

  let timeline = new SolarTimeline();
  let belt = new BeltDynamics(timeline.system.bodies);
  let impact = new ImpactLab();
  let flight = new MarsFlight();
  let states = timeline.read();
  views.orbit = new OrbitView(canvas);
  const pacing = new FramePacing(resize);

  function resize() {
    width = Math.max(1, stage.clientWidth);
    height = Math.max(1, stage.clientHeight);
    gl.setPixelRatio(pacing.ratio);
    gl.setSize(width, height, false);
    views[mode].resize(width, height);
    renderNeeded = true;
  }

  function ensureView(name) {
    if (views[name]) return views[name];
    const view = name === 'impact' ? new ImpactView(canvas) : new FlightView(canvas, views.orbit.planets[4].texture);
    view.controls.addEventListener('change', () => { renderNeeded = true; });
    view.resize(width, height);
    if (name === 'impact') view.resetCamera();
    views[name] = view;
    return view;
  }

  function resetClock(name) {
    clocks[name].remainder = 0;
    clocks[name].limited = false;
  }

  function resetOrbit() {
    timeline = new SolarTimeline();
    states = timeline.read();
    belt = new BeltDynamics(timeline.system.bodies);
    views.orbit.resetTraces();
    renderNeeded = true;
  }

  function resetImpact(trial = impact.trial) {
    const restitution = impact.restitution;
    impact = new ImpactLab(trial);
    impact.restitution = restitution;
    sessions.impact.running = false;
    resetClock('impact');
    renderNeeded = true;
    sync();
  }

  function resetFlight(checkpoint = flight.checkpoint) {
    flight = new MarsFlight(checkpoint);
    sessions.flight.running = false;
    sessions.flight.rate = 0;
    resetClock('flight');
    clearControls();
    renderNeeded = true;
    sync();
  }

  function setMode(name) {
    if (name === mode) return;
    views[mode].controls.enabled = false;
    mode = name;
    const view = ensureView(mode);
    view.controls.enabled = true;
    gl.shadowMap.enabled = mode === 'flight';
    $('workspace').dataset.mode = mode;
    for (const button of modeButtons) pressed(button, button.dataset.mode === mode);
    for (const panel of panels) panel.hidden = panel.dataset.panel !== mode;
    for (const panel of stagePanels) panel.hidden = panel.dataset.stage !== mode;
    $('orbit-labels').hidden = mode !== 'orbit';
    $('impact-labels').hidden = mode !== 'impact';
    $('flight-labels').hidden = mode !== 'flight';
    $('camera-toggle').hidden = mode !== 'flight';
    $('path-toggle').hidden = mode === 'flight';
    contacts.hidden = mode !== 'flight' || flight.status !== 'flying';
    clearControls();
    pacing.clear();
    lastFrame = undefined;
    resize();
    sync();
  }

  function select(index) {
    selected = index;
    const { body, texture } = views.orbit.planets[index];
    for (let i = 0; i < catalog.length; i++) {
      pressed(catalog[i], i === index);
      pressed(labels[i], i === index);
    }
    views.orbit.select(body.id);
    if (views.orbit.focused) views.orbit.focus(body.id);
    const portrait = $('portrait');
    portrait.style.setProperty('--portrait-shadow', `color-mix(in srgb, ${body.color} 20%, #151b23)`);
    paintPlanet($('body-art'), texture, body);
    text('body-name', body.name);
    text('body-kind', body.kind);
    text('body-description', body.description);
    const detail = inspectPlanet(selected, states);
    text('body-radius', `${integer(detail.radiusKm)} km`);
    text('body-gravity', `${detail.surfaceGravity.toFixed(2)} m/s²`);
    renderNeeded = true;
    sync();
  }

  function setFocus(focus) {
    views.orbit.focus(focus ? PLANETS[selected].id : null);
    renderNeeded = true;
    sync();
  }

  function sync() {
    const session = sessions[mode];
    const [frame, title] = viewTitles[mode];
    text('stage-frame', mode === 'orbit' && views.orbit.focused ? 'Tracking a celestial body' : frame);
    text('stage-title', mode === 'orbit' && views.orbit.focused ? PLANETS[selected].name : title);
    text('path-toggle', mode === 'impact' ? 'Bounds' : 'Orbits');
    text('label-toggle', mode === 'flight' ? 'Landing zone' : 'Labels');
    if (views.flight) text('camera-toggle', views.flight.view === 'chase' ? 'Overhead' : 'Chase');
    pressed($('path-toggle'), session.paths);
    pressed($('label-toggle'), session.labels);
    updateTelemetry();
  }

  function completed() {
    return mode === 'flight' ? flight.status !== 'flying' : mode === 'impact' && impact.time >= impact.duration;
  }

  function updateTransport() {
    const session = sessions[mode];
    const play = $('time-play');
    const paused = !session.running;
    play.classList.toggle('playing', !paused);
    play.disabled = mode === 'flight' && completed();
    const name = paused ? 'Play simulation' : 'Pause simulation';
    if (play.title !== name) {
      play.setAttribute('aria-label', name);
      play.title = name;
    }
    $('time-step').disabled = !paused || completed();
    $('time-step').title = mode === 'orbit' ? 'Step one simulation hour' : mode === 'impact' ? 'Step 0.5 seconds' : 'Step one flight frame';
    text('sim-status', completed() ? 'Complete' : paused ? 'Paused' : 'Running');
    $('status-light').classList.toggle('paused', paused);
    const slider = $('time-rate');
    const levels = rates[mode];
    const [value, label, spoken] = levels[session.rate];
    slider.max = levels.length - 1;
    if (Number(slider.value) !== session.rate) slider.value = session.rate;
    slider.setAttribute('aria-valuetext', mode === 'orbit' ? `${spoken} per second` : spoken);
    $('rate-down').disabled = session.rate === 0;
    $('rate-up').disabled = session.rate === levels.length - 1;
    const capped = mode === 'flight' && value > allowedFlightRate(flight.altitude);
    text('rate-value', capped ? `${allowedFlightRate(flight.altitude)}× (cap)` : label);
    slider.title = capped ? `${label} selected. Flight slows near the surface.` : label;
    text('time-note', mode === 'orbit' ? (timeline.limited ? 'Integrator at frame limit' : 'Leapfrog · 1 h step')
      : mode === 'impact' ? 'Continuous collision detection' : (capped ? 'Time capped near terrain' : 'Fixed step · 60 Hz'));
  }

  function updateTelemetry() {
    updateTransport();
    if (mode === 'orbit') {
      text('time-label', 'Simulation date');
      timeDisplay(...dateParts(EPOCH + timeline.time * 1000));
      const detail = inspectPlanet(selected, states);
      text('body-distance', selected ? `${detail.distanceAU.toFixed(3)} AU` : '—');
      text('body-speed', selected ? `${detail.speedKmS.toFixed(2)} km/s` : '—');
      text('body-period', detail.periodLabel ?? '—');
      text('body-eccentricity', detail.eccentricity == null ? '—' : detail.eccentricity.toFixed(5));
      buttonLabel('focus-body', views.orbit.focused ? 'Return to system' : `Focus on ${PLANETS[selected].name}`);
    } else if (mode === 'impact') {
      text('time-label', 'Experiment elapsed');
      timeDisplay(impact.time.toFixed(2), 's');
      text('trial-name', TRIALS[impact.trial].label);
      text('trial-description', trialNotes[impact.trial]);
      for (const button of trialButtons) pressed(button, button.dataset.trial === impact.trial);
      text('restitution-value', impact.restitution.toFixed(2));
      const [a, b] = impact.rocks;
      text('speed-a', speed(norm(a.velocity) * 1000));
      text('speed-b', speed(norm(b.velocity) * 1000));
      text('separation', `${norm(sub(a.position, b.position)).toFixed(2)} km`);
      const hit = impact.events[0];
      text('impact-time', hit ? `${hit.time.toFixed(3)} s` : '—');
      const fraction = rockEnergy(impact.rocks) / impact.initialEnergy;
      $('energy-meter').value = fraction;
      text('energy-text', `${(fraction * 100).toFixed(1)}%`);
      text('impact-overlay', hit ? 'Impact detected' : completed() ? 'Clear pass' : impact.time ? 'Tracking trajectories' : 'Trial ready');
      text('impact-result', hit ? `Contact at ${hit.time.toFixed(3)} s. Normal approach speed ${speed(hit.incomingNormalSpeed * 1000)}.`
        : completed() ? 'The rocks passed without contact.' : impact.time ? 'Tracking both rocks.' : 'Ready to run.');
      buttonLabel('run-experiment', sessions.impact.running ? 'Pause experiment' : completed() ? 'Run again' : impact.time ? 'Resume experiment' : 'Run experiment');
    } else {
      text('time-label', 'Mission elapsed');
      const minutes = Math.floor(flight.time / 60);
      timeDisplay(`${String(minutes).padStart(2, '0')}:${(flight.time % 60).toFixed(1).padStart(4, '0')}`, 'MET');
      text('flight-checkpoint', flight.checkpoint === 'practice' ? 'Landing practice' : 'Inbound approach');
      const [x, , z] = flight.position;
      const [vx, vy, vz] = flight.contact?.velocity ?? flight.velocity;
      const parts = distance(Math.max(0, flight.altitude)).split(' ');
      const outer = $('altitude');
      if (outer.firstChild.nodeValue !== `${parts[0]} `) outer.firstChild.nodeValue = `${parts[0]} `;
      if (outer.lastElementChild.textContent !== parts[1]) outer.lastElementChild.textContent = parts[1];
      text('target-direction', `${x <= 0 ? 'E' : 'W'} ${distance(Math.abs(x))} · ${z >= 0 ? 'N' : 'S'} ${distance(Math.abs(z))}`);
      text('vertical-speed', speed(vy));
      text('lateral-speed', speed(Math.hypot(vx, vz)));
      text('pad-distance', distance(Math.hypot(x, z)));
      text('throttle', `${Math.round(flight.throttle * 100)}%`);
      $('fuel-meter').value = flight.fuel / flight.startFuel;
      text('fuel-text', `${integer(flight.fuel)} kg`);
      const phase = flight.status === 'landed' || flight.status === 'off-pad' ? 'touchdown' : phaseForAltitude(flight.altitude);
      const order = plan.findIndex((item) => item.dataset.phase === phase);
      for (let index = 0; index < plan.length; index++) {
        plan[index].classList.toggle('current', index === order);
        plan[index].classList.toggle('done', index < order);
        if (index === order) plan[index].setAttribute('aria-current', 'step');
        else plan[index].removeAttribute('aria-current');
      }
      const result = $('flight-result');
      if (result.dataset.terminal !== flight.status) result.dataset.terminal = flight.status;
      const statusText = {
        landed: 'Touchdown confirmed. Mission complete.', 'off-pad': 'Safe touchdown outside the landing zone.',
        crashed: 'Unsafe touchdown. Reset the flight to try again.', departed: 'The lander exited the approach area.',
      };
      const inFlight = flight.guidance ? 'Guidance flying. Manual thrust takes control.' : 'Manual flight. Use the main engine to slow descent.';
      text('flight-result', statusText[flight.status] ?? (sessions.flight.running ? inFlight : flight.time ? 'Flight paused.'
        : flight.checkpoint === 'practice' ? 'Ready for final descent practice.' : 'Ready at the approach checkpoint.'));
      buttonLabel('start-flight', completed() ? 'Restart flight' : sessions.flight.running ? 'Pause flight' : flight.time ? 'Resume flight' : 'Start manual flight');
      buttonLabel('guidance', flight.guidance && flight.status === 'flying' ? 'Disengage guidance' : 'Engage guidance');
      pressed($('guidance'), flight.guidance && flight.status === 'flying');
      $('guidance').disabled = completed();
      text('flight-checkpoint-action', flight.checkpoint === 'practice' ? 'Return to inbound approach' : 'Practice final descent');
      contacts.hidden = completed();
    }
  }

  function controlState() {
    const has = (code) => keys.has(code) || [...pointers.values()].includes(code);
    return {
      x: Number(has('KeyD')) - Number(has('KeyA')),
      z: Number(has('KeyS')) - Number(has('KeyW')),
      lift: has('Space'), brake: has('ShiftLeft') || has('ShiftRight'),
    };
  }

  function clearControls() {
    keys.clear();
    pointers.clear();
    for (const button of contacts.querySelectorAll('.active')) button.classList.remove('active');
  }

  function integrateOrbit(seconds) {
    timeline.advance(seconds, 48, (before, after, end) => belt.step(before, after, ORBIT_STEP, end));
    states = timeline.read();
  }

  function advance(seconds) {
    const session = sessions[mode];
    if (!session.running) return;
    const rate = rates[mode][session.rate][0];
    if (mode === 'orbit') integrateOrbit(seconds * rate);
    else if (mode === 'impact') clocks.impact.advance(seconds * rate, (dt) => impact.step(dt));
    else {
      const controls = controlState();
      clocks.flight.advance(seconds * Math.min(rate, allowedFlightRate(flight.altitude)), (dt) => flight.step(dt, controls));
    }
    if (completed()) {
      session.running = false;
      sync();
    }
    renderNeeded = true;
  }

  function render() {
    const view = views[mode];
    const { paths, labels: showLabels } = sessions[mode];
    const ratio = gl.getPixelRatio();
    if (mode === 'orbit') {
      view.update(states, timeline.time, belt, timeline.system.time, ratio, paths);
      for (let i = 0; i < labels.length; i++) {
        const item = labels[i];
        if (!showLabels || (view.focused && selected !== i)) {
          item.hidden = true;
          continue;
        }
        const point = view.project(i, width, height);
        const shift = i === 0 ? 18 : 7;
        const dx = point[0] > width - 115 ? -item.dataset.labelLength * 6.4 - shift : shift;
        showProjected(item, point, width, height, { dx, dy: i === 0 ? -24 : -12 });
      }
    } else if (mode === 'impact') {
      view.update(impact, ratio, paths);
      for (const [i, id] of ['asteroid-label-a', 'asteroid-label-b'].entries()) {
        const item = $(id);
        if (showLabels) showProjected(item, view.project(i, width, height), width, height, { dx: -18, dy: -21 });
        else item.hidden = true;
      }
    } else {
      view.update(flight, ratio, showLabels);
      if (showLabels) showProjected($('pad-marker'), view.projectPad(width, height), width, height, { dx: -37, dy: -30 });
      else $('pad-marker').hidden = true;
    }
    gl.render(view.scene, view.camera);
  }

  function animate(now) {
    requestAnimationFrame(animate);
    if (contextLost || document.hidden) return;
    const start = performance.now();
    const delta = lastFrame == null ? 0 : now - lastFrame;
    lastFrame = now;
    advance(Math.min(delta / 1000, 0.1));
    if (renderNeeded) {
      renderNeeded = false;
      render();
      if (sessions[mode].running) pacing.sample(delta, performance.now() - start);
    }
    if (now - lastTelemetry > 85) {
      updateTelemetry();
      lastTelemetry = now;
    }
  }

  function changeRate(index) {
    sessions[mode].rate = clamp(index, 0, rates[mode].length - 1);
    sync();
  }

  function togglePlay() {
    if (mode === 'flight' && completed()) return;
    if (mode === 'impact' && completed()) resetImpact();
    sessions[mode].running = !sessions[mode].running;
    renderNeeded = true;
    sync();
  }

  function toggleGuidance() {
    if (mode !== 'flight' || completed()) return;
    clearControls();
    flight.guidance = !flight.guidance;
    if (flight.guidance) sessions.flight.running = true;
    focusFlight();
    sync();
  }

  function focusFlight() {
    canvas.focus({ preventScroll: true });
    if (matchMedia('(pointer: coarse)').matches) stage.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function stepTime() {
    if (sessions[mode].running || completed()) return;
    if (mode === 'orbit') integrateOrbit(ORBIT_STEP);
    else if (mode === 'impact') impact.step(0.5);
    else flight.step(FLIGHT_STEP, controlState());
    renderNeeded = true;
    sync();
  }

  function resetCamera() {
    if (mode === 'orbit') setFocus(false);
    else if (mode === 'impact') views.impact.resetCamera();
    else views.flight.changeCamera('chase');
    renderNeeded = true;
    sync();
  }

  PLANETS.forEach((body, index) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'body-button';
    element.style.setProperty('--planet', body.color);
    element.innerHTML = `<span class="mini-planet ${body.id}${body.size > 1 ? ' giant' : ''}" aria-hidden="true"></span>
      <span><strong>${body.name}</strong><small>${body.kind}</small></span><span class="body-arrow" aria-hidden="true">›</span>`;
    element.setAttribute('aria-label', body.name);
    element.addEventListener('click', () => select(index));
    element.addEventListener('dblclick', () => setFocus(true));
    $('body-catalog').append(element);
    catalog.push(element);
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'object-label';
    label.dataset.labelLength = body.name.length;
    label.textContent = body.name;
    label.addEventListener('click', () => select(index));
    label.addEventListener('dblclick', () => setFocus(true));
    $('orbit-labels').append(label);
    labels.push(label);
  });

  for (const button of modeButtons) button.addEventListener('click', () => setMode(button.dataset.mode));
  for (const button of trialButtons) button.addEventListener('click', () => resetImpact(button.dataset.trial));
  $('restitution').addEventListener('input', (event) => {
    impact.restitution = Number(event.target.value);
    sync();
  });
  $('home').addEventListener('click', () => { setMode('orbit'); setFocus(false); });
  $('focus-body').addEventListener('click', () => setFocus(!views.orbit.focused));
  $('launch-mission').addEventListener('click', () => setMode('flight'));
  $('path-toggle').addEventListener('click', () => { sessions[mode].paths = !sessions[mode].paths; renderNeeded = true; sync(); });
  $('label-toggle').addEventListener('click', () => { sessions[mode].labels = !sessions[mode].labels; renderNeeded = true; sync(); });
  $('camera-reset').addEventListener('click', resetCamera);
  $('camera-toggle').addEventListener('click', () => {
    const view = views.flight;
    view.changeCamera(view.view === 'chase' ? 'overhead' : 'chase');
    renderNeeded = true;
    sync();
  });
  $('run-experiment').addEventListener('click', togglePlay);
  $('reset-experiment').addEventListener('click', () => resetImpact());
  $('start-flight').addEventListener('click', () => {
    if (completed()) resetFlight();
    else togglePlay();
    focusFlight();
  });
  $('guidance').addEventListener('click', toggleGuidance);
  $('flight-checkpoint-action').addEventListener('click', () => resetFlight(flight.checkpoint === 'approach' ? 'practice' : 'approach'));
  $('time-play').addEventListener('click', togglePlay);
  $('time-step').addEventListener('click', stepTime);
  $('time-reset').addEventListener('click', () => {
    if (mode === 'orbit') resetOrbit();
    else if (mode === 'impact') resetImpact();
    else resetFlight();
    sync();
  });
  $('rate-down').addEventListener('click', () => changeRate(sessions[mode].rate - 1));
  $('rate-up').addEventListener('click', () => changeRate(sessions[mode].rate + 1));
  $('time-rate').addEventListener('input', (event) => changeRate(Number(event.target.value)));
  $('open-help').addEventListener('click', () => { clearControls(); $('help-dialog').showModal(); });
  $('render-quality').addEventListener('change', (event) => pacing.setQuality(event.target.value));

  const manualKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'];
  window.addEventListener('keydown', (event) => {
    if ($('help-dialog').open || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.target.closest?.('input, select, textarea, [contenteditable]')) return;
    if (mode === 'flight' && manualKeys.includes(event.code)) {
      if (event.code === 'Space' && event.target.closest?.('button')) return;
      event.preventDefault();
      keys.add(event.code);
    } else if (!event.repeat && (event.code === 'KeyP' || (event.code === 'Space' && mode !== 'flight'
      && !event.target.closest?.('button')))) {
      event.preventDefault();
      togglePlay();
    } else if (!event.repeat && event.code === 'KeyF') toggleGuidance();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.code));
  window.addEventListener('blur', clearControls);
  document.addEventListener('visibilitychange', () => { clearControls(); lastFrame = undefined; pacing.clear(); });
  for (const button of contacts.querySelectorAll('[data-thrust]')) {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, button.dataset.thrust);
      button.classList.add('active');
    });
    const release = (event) => {
      pointers.delete(event.pointerId);
      button.classList.remove('active');
    };
    for (const edge of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(edge, release);
  }

  let downPosition;
  canvas.addEventListener('pointerdown', (event) => { downPosition = [event.clientX, event.clientY]; });
  canvas.addEventListener('pointerup', (event) => {
    if (mode === 'orbit' && downPosition && Math.hypot(event.clientX - downPosition[0], event.clientY - downPosition[1]) < 5) {
      const bounds = canvas.getBoundingClientRect();
      const picked = views.orbit.pick(2 * (event.clientX - bounds.left) / bounds.width - 1,
        1 - 2 * (event.clientY - bounds.top) / bounds.height);
      const index = PLANETS.findIndex(({ id }) => id === picked);
      if (index >= 0) select(index);
    }
    downPosition = undefined;
  });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    contextLost = true;
    sessions[mode].running = false;
    $('view-error').hidden = false;
    text('view-error', 'The graphics context was interrupted. The simulation is paused while it recovers.');
    sync();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    lastFrame = undefined;
    resize();
    $('view-error').hidden = true;
  });

  if (new URLSearchParams(location.search).has('diagnostics')) {
    const context = gl.getContext();
    const rendererInfo = context.getExtension('WEBGL_debug_renderer_info');
    window.apsisDiagnostics = {
      frameStats: () => pacing.stats(),
      resetFrameStats: () => pacing.clear(),
      renderInfo: () => ({ ...gl.info.render, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures }),
      renderer: () => rendererInfo ? context.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER),
      snapshot: () => telemetrySnapshot({ mode, states, index: selected, time: timeline.time, running: sessions[mode].running,
        rate: rates[mode][sessions[mode].rate][0] }),
      state: () => ({ mode, running: sessions[mode].running, orbitTime: timeline.time, rate: rates[mode][sessions[mode].rate][0],
        selected: PLANETS[selected].id, focused: views.orbit.focused, beltImpacts: belt.impactCount,
        impact: { time: impact.time, collisions: impact.events.length, energyRetained: rockEnergy(impact.rocks) / impact.initialEnergy },
        flight: { time: flight.time, status: flight.status, altitude: flight.altitude, thrust: flight.throttle,
          guidance: flight.guidance, checkpoint: flight.checkpoint, contact: flight.contact, fuel: flight.fuel,
          position: [...flight.position], velocity: [...flight.velocity] },
      }),
    };
  }

  views.orbit.controls.addEventListener('change', () => { renderNeeded = true; });
  new ResizeObserver(resize).observe(stage);
  resize();
  select(selected);
  render();
  $('view-error').hidden = true;
  requestAnimationFrame(animate);
}

boot();
