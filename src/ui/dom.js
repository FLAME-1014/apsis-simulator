export const $ = (id) => document.getElementById(id);

export function text(id, value) {
  const item = $(id);
  const label = String(value);
  if (item.textContent !== label) item.textContent = label;
}

export function buttonLabel(id, value) {
  const button = $(id);
  const label = `${value} `;
  if (button.firstChild.nodeValue !== label) button.firstChild.nodeValue = label;
}

export function pressed(element, value) {
  const state = String(Boolean(value));
  if (element.getAttribute('aria-pressed') !== state) element.setAttribute('aria-pressed', state);
}

const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
export const integer = (value) => whole.format(value);
export const distance = (meters) => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
export const speed = (mps) => `${Math.abs(mps) < 10 ? mps.toFixed(1) : Math.round(mps)} m/s`.replace('-', '−');
export const dateParts = (epoch) => [dateFormat.format(epoch), `${timeFormat.format(epoch)} UTC`];

export function timeDisplay(value, unit) {
  const outer = $('sim-date');
  if (outer.firstChild.nodeValue !== `${value} `) outer.firstChild.nodeValue = `${value} `;
  if (outer.lastElementChild.textContent !== unit) outer.lastElementChild.textContent = unit;
}

export function showProjected(element, point, width, height, { dx = 0, dy = 0, margin = 12 } = {}) {
  const [x, y, front] = point;
  const visible = front && x > margin && x < width - margin && y > 63 && y < height - 36;
  element.hidden = !visible;
  if (visible) element.style.transform = `translate(${Math.round(x + dx)}px, ${Math.round(y + dy)}px)`;
}
