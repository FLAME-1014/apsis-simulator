import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const contentType = {
  '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript',
  '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff',
};

export async function serveBuild() {
  await readFile(resolve(dist, 'index.html'));
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      const dest = resolve(dist, `.${path === '/' ? '/index.html' : path}`);
      const within = relative(dist, dest);
      if (within.startsWith('..') || isAbsolute(within)) return response.writeHead(404).end();
      const bytes = await readFile(dest);
      response.writeHead(200, { 'Content-Type': contentType[extname(dest)] ?? 'application/octet-stream' }).end(bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((ready, failed) => {
    server.once('error', failed);
    server.listen(0, '127.0.0.1', ready);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/?diagnostics=1`,
    close: () => new Promise((done) => server.close(done)),
  };
}

export function openBrowser() {
  const channel = process.env.APSIS_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'chrome' : undefined);
  const angle = process.env.APSIS_ANGLE;
  return chromium.launch({
    channel: channel === 'default' ? undefined : channel,
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', ...(angle ? [`--use-angle=${angle}`] : [])],
  });
}
