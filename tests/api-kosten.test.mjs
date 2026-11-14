/*
 * Die Funktion api-kosten: Andere Apps am selben Anthropic-Zugang melden ihre
 * Kosten. Sie weisen sich mit der Prüfsumme (SHA-256) ihres Schlüssels aus –
 * den Schlüssel selbst bekommt die Funktion nicht. Läuft mit Deno gegen die
 * Attrappe.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { starteAttrappe } from './attrappe.mjs';
import { starteFunktion } from './umgebung.mjs';

const URSPRUNG = 'https://finanzdienste.github.io';
const summe = (s) => createHash('sha256').update(s).digest('hex');
// Der eigene Schlüssel der Funktion (umgebung.mjs) und ein weiterer derselben Organisation, über ERLAUBTE_SCHLUESSEL
const EIGEN = summe('test-schluessel');
const BOXENSTOPP = summe('sk-ant-boxenstopp-test');
let attrappe;
let funktion;

before(async () => {
  attrappe = await starteAttrappe();
  funktion = await starteFunktion({ attrappe: attrappe.url, urspruenge: [URSPRUNG], datei: 'api-kosten-lokal.ts', schluesselSummen: [BOXENSTOPP.toUpperCase(), 'kaputt'] });
});

after(async () => {
  await funktion?.schliessen();
  await attrappe?.schliessen();
});

const melde = (koerper, kopf = { 'x-schluessel-hash': BOXENSTOPP }) => fetch(funktion.url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: URSPRUNG, ...kopf },
  body: JSON.stringify(koerper),
});

test('Vorabfrage des Browsers erlaubt die Prüfsumme – den Schlüssel nicht mehr', async () => {
  const antwort = await fetch(funktion.url, { method: 'OPTIONS', headers: { Origin: URSPRUNG } });
  assert.equal(antwort.status, 204);
  assert.equal(antwort.headers.get('access-control-allow-origin'), URSPRUNG);
  assert.match(antwort.headers.get('access-control-allow-headers'), /x-schluessel-hash/);
  assert.doesNotMatch(antwort.headers.get('access-control-allow-headers'), /x-anthropic-key/);
});

test('eine erlaubte Prüfsumme darf melden; die Zeile hat keinen Inhalt; Anthropic wird nicht gefragt', async () => {
  const vorher = attrappe.kosten.length;
  const abfragen = attrappe.modellAbfragen.length;
  const antwort = await melde({ app: 'boxenstopp', modell: 'claude-opus-5-5', usd: 0.1234567 });
  assert.equal(antwort.status, 204);
  assert.equal(attrappe.kosten.length, vorher + 1);
  const zeile = attrappe.kosten.at(-1);
  assert.deepEqual(Object.keys(zeile).sort(), ['app', 'modell', 'nutzer', 'usd', 'zeit']);
  assert.equal(zeile.app, 'boxenstopp');
  assert.equal(zeile.usd, 0.123457);
  assert.equal(zeile.nutzer, '00000000-0000-0000-0000-000000000000');
  assert.ok(!JSON.stringify(zeile).includes(BOXENSTOPP), 'keine Prüfsumme in der Tabelle');
  assert.equal(attrappe.modellAbfragen.length, abfragen, 'kein Schlüssel geht an Anthropic');
});

test('die Prüfsumme des eigenen Schlüssels (wie bei amy-chat) darf auch melden – groß oder klein geschrieben', async () => {
  assert.equal((await melde({ app: 'boxenstopp', modell: 'claude-opus-5-5', usd: 0.01 }, { 'x-schluessel-hash': EIGEN })).status, 204);
  assert.equal((await melde({ app: 'boxenstopp', modell: 'claude-opus-5-5', usd: 0.01 }, { 'x-schluessel-hash': EIGEN.toUpperCase() })).status, 204);
});

test('unbekannte, kaputte oder fehlende Prüfsumme – und der Schlüssel selbst – zählen nicht', async () => {
  const vorher = attrappe.kosten.length;
  const abfragen = attrappe.modellAbfragen.length;
  assert.equal((await melde({ app: 'boxenstopp', modell: 'x', usd: 1 }, { 'x-schluessel-hash': summe('sk-ant-fremder-test') })).status, 403);
  assert.equal((await melde({ app: 'boxenstopp', modell: 'x', usd: 1 }, { 'x-schluessel-hash': 'kaputt' })).status, 401);
  assert.equal((await melde({ app: 'boxenstopp', modell: 'x', usd: 1 }, {})).status, 401);
  // So meldeten ältere Fassungen: den Schlüssel im Kopf – das geht nicht mehr, und er geht nirgends hin
  assert.equal((await melde({ app: 'boxenstopp', modell: 'x', usd: 1 }, { 'x-anthropic-key': 'sk-ant-boxenstopp-test' })).status, 401);
  assert.equal(attrappe.kosten.length, vorher);
  assert.equal(attrappe.modellAbfragen.length, abfragen);
});

test('Unsinn wird nicht eingetragen', async () => {
  const vorher = attrappe.kosten.length;
  for (const k of [
    { app: 'fragmal', modell: 'x', usd: 1 },
    { app: 'Böse App', modell: 'x', usd: 1 },
    { app: 'boxenstopp', modell: 'x', usd: 0 },
    { app: 'boxenstopp', modell: 'x', usd: 500 },
    { app: 'boxenstopp', modell: '', usd: 1 },
  ]) {
    assert.equal((await melde(k)).status, 400, JSON.stringify(k));
  }
  assert.equal(attrappe.kosten.length, vorher);
});
