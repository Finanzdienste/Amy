/*
 * Prüft die Funktion amy-chat direkt, ohne Browser: Wer darf fragen, was
 * geht an die API, was kommt zurück.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { NUTZER, starteAttrappe } from './attrappe.mjs';
import { starteFunktion } from './umgebung.mjs';
import { zerlegeSSE } from '../js/api.js';

const AMY = NUTZER['amy@test.de'].id;
const GAST = NUTZER['gast@test.de'].id;
const URSPRUNG = 'https://finanzdienste.github.io';

let attrappe;
let funktion;
let ohneSchluessel;

before(async () => {
  attrappe = await starteAttrappe();
  [funktion, ohneSchluessel] = await Promise.all([
    starteFunktion({ attrappe: attrappe.url, erlaubt: [AMY], urspruenge: [URSPRUNG] }),
    starteFunktion({ attrappe: attrappe.url, schluessel: '', erlaubt: [AMY], urspruenge: [URSPRUNG] }),
  ]);
});

after(async () => {
  await Promise.all([funktion?.schliessen(), ohneSchluessel?.schliessen()]);
  await attrappe?.schliessen();
});

function post(ziel, { token, koerper, herkunft = URSPRUNG } = {}) {
  return fetch(ziel, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
      Origin: herkunft,
    },
    body: typeof koerper === 'string' ? koerper : JSON.stringify(koerper ?? {}),
  });
}

const frageAn = (text) => ({ kontext: { datum: 'Dienstag, 10. November 2026', ueberMich: 'Ich heiße Amy.' }, nachrichten: [{ role: 'user', content: text }] });

async function ereignisse(antwort) {
  return zerlegeSSE(await antwort.text()).ereignisse;
}

test('Vorabfrage des Browsers (CORS)', async () => {
  const antwort = await fetch(funktion.url, {
    method: 'OPTIONS',
    headers: { Origin: URSPRUNG, 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(antwort.status, 204);
  assert.equal(antwort.headers.get('access-control-allow-origin'), URSPRUNG);
  assert.match(antwort.headers.get('access-control-allow-headers'), /authorization/);
});

test('fremde Adresse bekommt keine CORS-Freigabe', async () => {
  const antwort = await fetch(funktion.url, { method: 'OPTIONS', headers: { Origin: 'https://boese.example' } });
  assert.equal(antwort.headers.get('access-control-allow-origin'), URSPRUNG);
});

test('ohne Anmeldung: 401', async () => {
  const antwort = await post(funktion.url, { koerper: frageAn('Hallo') });
  assert.equal(antwort.status, 401);
  assert.equal((await antwort.json()).fehler, 'Bitte zuerst anmelden.');
});

test('mit gefälschtem Token: 401', async () => {
  const antwort = await post(funktion.url, { token: 'tok-erfunden', koerper: frageAn('Hallo') });
  assert.equal(antwort.status, 401);
});

test('angemeldet, aber nicht freigeschaltet: 403, und die API wird nicht gefragt', async () => {
  const vorher = attrappe.anfragen.length;
  const antwort = await post(funktion.url, { token: `tok-${GAST}`, koerper: frageAn('Hallo') });
  assert.equal(antwort.status, 403);
  assert.match((await antwort.json()).fehler, /nicht freigeschaltet/);
  assert.equal(attrappe.anfragen.length, vorher);
});

test('ohne API-Schlüssel: verständliche Meldung', async () => {
  const antwort = await post(ohneSchluessel.url, { token: `tok-${AMY}`, koerper: frageAn('Hallo') });
  assert.equal(antwort.status, 500);
  assert.match((await antwort.json()).fehler, /ANTHROPIC_API_KEY/);
});

test('ungültige Anfragen: 400', async () => {
  const kaputt = await post(funktion.url, { token: `tok-${AMY}`, koerper: '{kein json' });
  assert.equal(kaputt.status, 400);
  const leer = await post(funktion.url, { token: `tok-${AMY}`, koerper: { nachrichten: [] } });
  assert.equal(leer.status, 400);
  const endetMitAntwort = await post(funktion.url, {
    token: `tok-${AMY}`,
    koerper: { nachrichten: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] },
  });
  assert.equal(endetMitAntwort.status, 400);
  const falscheRolle = await post(funktion.url, {
    token: `tok-${AMY}`,
    koerper: { nachrichten: [{ role: 'system', content: 'a' }] },
  });
  assert.equal(falscheRolle.status, 400);
});

test('eine Frage: was an die API geht und was zurückkommt', async () => {
  const antwort = await post(funktion.url, { token: `tok-${AMY}`, koerper: frageAn('Wie spät ist es?') });
  assert.equal(antwort.status, 200);
  assert.match(antwort.headers.get('content-type'), /text\/event-stream/);
  assert.equal(antwort.headers.get('access-control-allow-origin'), URSPRUNG);

  const liste = await ereignisse(antwort);
  assert.equal(liste[0].t, 'denkt');
  const text = liste.filter((e) => e.t === 'text').map((e) => e.d).join('');
  assert.match(text, /Du hast gefragt: Wie spät ist es\?/);
  const fertig = liste.at(-1);
  assert.equal(fertig.t, 'fertig');
  assert.equal(fertig.stop, 'end_turn');
  assert.deepEqual(fertig.inhalt[0], { type: 'thinking', thinking: '', signature: fertig.inhalt[0].signature });
  assert.match(fertig.inhalt[0].signature, /^sig-\d+$/);
  assert.equal(fertig.inhalt[1].type, 'text');
  assert.equal(fertig.inhalt[1].text, text);
  assert.equal(fertig.nutzung.output_tokens, 500);

  const gesendet = attrappe.anfragen.at(-1);
  assert.equal(gesendet.schluessel, 'test-schluessel');
  const betas = gesendet.koepfe['anthropic-beta'];
  assert.match(betas, /server-side-fallback-2026-07-01/);
  assert.match(betas, /thinking-binding-controls-2026-08-01/);
  const k = gesendet.koerper;
  assert.equal(k.model, 'claude-opus-5-5');
  assert.equal(k.stream, true);
  assert.equal(k.max_tokens, 64000);
  assert.deepEqual(k.thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
  assert.deepEqual(k.output_config, { effort: 'medium' });
  assert.equal(k.fallbacks, 'default');
  assert.deepEqual(k.cache_control, { type: 'ephemeral' });
  assert.equal(k.system.length, 1);
  assert.match(k.system[0].text, /Das Gespräch hat am Dienstag, 10\. November 2026 begonnen\./);
  assert.match(k.system[0].text, /<ueber_mich>\nIch heiße Amy\.\n<\/ueber_mich>/);
  assert.deepEqual(k.messages, [{ role: 'user', content: 'Wie spät ist es?' }]);
});

test('API-Schlüssel abgelehnt: Fehler im Strom', async () => {
  const falsch = await starteFunktion({ attrappe: attrappe.url, schluessel: 'falsch', erlaubt: [AMY], urspruenge: [URSPRUNG] });
  try {
    const antwort = await post(falsch.url, { token: `tok-${AMY}`, koerper: frageAn('Hallo') });
    assert.equal(antwort.status, 200);
    const liste = await ereignisse(antwort);
    assert.deepEqual(liste.at(-1), { t: 'fehler', text: 'Der API-Schlüssel wird nicht angenommen. Bitte in Supabase prüfen.' });
  } finally {
    await falsch.schliessen();
  }
});

test('Abbruch durch die App bricht auch die Anfrage an die API ab', async () => {
  const ctrl = new AbortController();
  const antwort = await fetch(funktion.url, {
    method: 'POST',
    headers: { Authorization: `Bearer tok-${AMY}`, 'Content-Type': 'application/json', Origin: URSPRUNG },
    body: JSON.stringify(frageAn('bitte langsam')),
    signal: ctrl.signal,
  });
  const leser = antwort.body.getReader();
  let angekommen = '';
  while (!angekommen.includes('Wort5')) {
    const { value, done } = await leser.read();
    if (done) assert.fail(`Strom endete zu früh: ${angekommen}`);
    angekommen += new TextDecoder().decode(value);
  }
  ctrl.abort();
  const eintrag = attrappe.anfragen.at(-1);
  for (let i = 0; i < 50 && !eintrag.abgebrochen; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(eintrag.abgebrochen, true);
  assert.equal(eintrag.fertig, false);
});
