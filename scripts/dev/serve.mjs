// Zero-dependency static server for app/.
//
//   node scripts/dev/serve.mjs [--port 8000] [--host 127.0.0.1] [--live]
//
// --live injects a tiny live-reload client into HTML pages and reloads open
// tabs whenever a file under app/ changes. Responses are never cached, so a
// plain browser refresh always shows the latest source.
//
// Also importable: `const server = await startServer({ port: 0 })` returns
// { url, close } (used by the browser smoke/screenshot tool).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = resolve(fileURLToPath(new URL('../../app/', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const LIVE_CLIENT = `<script>(()=>{const s=new EventSource('/__live');s.onmessage=()=>location.reload();})();</script>`;

export async function startServer({
  port = 8000,
  host = '127.0.0.1',
  root = APP_ROOT,
  live = false,
} = {}) {
  const clients = new Set();
  let watcher = null;
  if (live) {
    let timer = null;
    watcher = watch(root, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const res of clients) res.write('data: reload\n\n');
      }, 80);
    });
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (live && url.pathname === '/__live') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      let path = normalize(join(root, decodeURIComponent(url.pathname)));
      if (path !== root && !path.startsWith(root + sep)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      let info = await stat(path).catch(() => null);
      if (info?.isDirectory()) {
        path = join(path, 'index.html');
        info = await stat(path).catch(() => null);
      }
      if (!info) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
        return;
      }
      const type = TYPES[extname(path).toLowerCase()] || 'application/octet-stream';
      let body = await readFile(path);
      if (live && type.startsWith('text/html'))
        body = Buffer.from(body.toString('utf8').replace('</body>', `${LIVE_CLIENT}</body>`));
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(error?.stack || error));
    }
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, ok);
  });
  const address = server.address();
  return {
    url: `http://${host}:${address.port}/`,
    close: () =>
      new Promise(ok => {
        watcher?.close();
        for (const res of clients) res.end();
        server.close(() => ok());
        server.closeAllConnections?.();
      }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const { url } = await startServer({
    port: Number(option('--port', process.env.PORT || 8000)),
    host: option('--host', '127.0.0.1'),
    live: args.includes('--live'),
  });
  console.log(`Serving app/ at ${url}${args.includes('--live') ? ' (live reload on)' : ''}`);
}
