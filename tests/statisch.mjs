/*
 * Liefert die App für die Tests aus. js/config.js wird dabei durch eine
 * Fassung ersetzt, die auf die Attrappe und die lokale Funktion zeigt.
 *
 * Auch von Hand nutzbar: `node tests/statisch.mjs 8299` zeigt die App mit
 * der echten Konfiguration unter http://localhost:8299/.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ARTEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

export async function starteStatisch({ port = 0, konfig = null } = {}) {
  const server = http.createServer(async (req, res) => {
    let pfad = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pfad.endsWith('/')) pfad += 'index.html';
    if (konfig && pfad === '/js/config.js') {
      res.writeHead(200, { 'Content-Type': ARTEN['.js'] });
      res.end(`export const KONFIG = ${JSON.stringify(konfig)};\n`);
      return;
    }
    const datei = path.join(wurzel, pfad);
    if (!datei.startsWith(wurzel) || pfad.includes('/node_modules/') || pfad.includes('/.git')) {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      const inhalt = await fs.readFile(datei);
      res.writeHead(200, { 'Content-Type': ARTEN[path.extname(datei)] || 'application/octet-stream' });
      res.end(inhalt);
    } catch {
      res.writeHead(404);
      res.end('nicht gefunden');
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    schliessen: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await starteStatisch({ port: Number(process.argv[2] || 8299) });
  console.log(`App unter ${s.url}/`);
}
