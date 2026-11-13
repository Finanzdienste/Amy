/*
 * Startet die Funktion amy-chat mit Deno, so wie Supabase sie ausführt, nur
 * lokal und gegen die Attrappe.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function denoPfad() {
  if (process.env.DENO) return process.env.DENO;
  const lokal = path.join(wurzel, 'node_modules', '.bin', 'deno');
  return fs.existsSync(lokal) ? lokal : 'deno';
}

export async function starteFunktion({ attrappe, schluessel = 'test-schluessel', geheim = 'sb_secret_test', erlaubt = [], urspruenge = [], herzschlag = '', datei = 'funktion-lokal.ts' }) {
  // --node-modules-dir=none: Deno holt npm-Pakete selbst, wie bei Supabase,
  // statt im node_modules der Tests zu suchen.
  const kind = spawn(denoPfad(), ['run', '--node-modules-dir=none', '--allow-net', '--allow-env', '--allow-read', '--allow-sys',
    path.join(wurzel, 'tests', datei)], {
    cwd: wurzel,
    env: {
      ...process.env,
      PORT: '0',
      ANTHROPIC_API_KEY: schluessel ?? '',
      SUPABASE_SERVICE_ROLE_KEY: geheim,
      ANTHROPIC_BASE_URL: attrappe,
      SUPABASE_URL: attrappe,
      ERLAUBTE_NUTZER: erlaubt.join(','),
      ERLAUBTE_URSPRUENGE: urspruenge.join(','),
      NO_COLOR: '1',
      HERZSCHLAG_MS: String(herzschlag),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ausgabe = '';
  const port = await new Promise((gut, schlecht) => {
    const zeit = setTimeout(() => schlecht(new Error(`Funktion startet nicht:\n${ausgabe}`)), 120_000);
    const lies = (s) => {
      ausgabe += s;
      const m = ausgabe.match(/bereit (\d+)/);
      if (m) {
        clearTimeout(zeit);
        gut(Number(m[1]));
      }
    };
    kind.stdout.on('data', lies);
    kind.stderr.on('data', lies);
    kind.on('exit', (code) => schlecht(new Error(`Funktion beendet (${code}):\n${ausgabe}`)));
  });
  return {
    url: `http://127.0.0.1:${port}`,
    protokoll: () => ausgabe,
    schliessen: () => new Promise((r) => {
      kind.removeAllListeners('exit');
      kind.once('exit', r);
      kind.kill();
    }),
  };
}
