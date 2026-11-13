/*
 * Die Funktion api-kosten: Andere Apps am selben Anthropic-Zugang melden ihre
 * Kosten. Läuft mit Deno gegen die Attrappe.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { starteAttrappe } from './attrappe.mjs';
import { starteFunktion } from './umgebung.mjs';

const URSPRUNG = 'https://finanzdienste.github.io';
let attrappe;
let funktion;

before(async () => {
  attrappe = await starteAttrappe();
  funktion = await starteFunktion({ attrappe: attrappe.url, urspruenge: [URSPRUNG], datei: 'api-kosten-lokal.ts' });
});

after(async () => {
  await funktion?.schliessen();
  await attrappe?.schliessen();
});

const melde = (koerper, schluessel = 'sk-ant-boxenstopp-test') => fetch(funktion.url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: URSPRUNG, ...(schluessel ? { 'x-anthropic-key': schluessel } : {}) },
  body: JSON.stringify(koerper),
});

test('Vorabfrage des Browsers erlaubt den Kopf mit dem Schlüssel', async () => {
  const antwort = await fetch(funktion.url, { method: 'OPTIONS', headers: { Origin: URSPRUNG } });
  assert.equal(antwort.status, 204);
  assert.equal(antwort.headers.get('access-control-allow-origin'), URSPRUNG);
  assert.match(antwort.headers.get('access-control-allow-headers'), /x-anthropic-key/);
});

test('ein Schlüssel derselben Organisation darf melden; die Zeile hat keinen Inhalt', async () => {
  const vorher = attrappe.kosten.length;
  const antwort = await melde({ app: 'boxenstopp', modell: 'claude-opus-5-5', usd: 0.1234567 });
  assert.equal(antwort.status, 204);
  assert.equal(attrappe.kosten.length, vorher + 1);
  const zeile = attrappe.kosten.at(-1);
  assert.deepEqual(Object.keys(zeile).sort(), ['app', 'modell', 'nutzer', 'usd', 'zeit']);
  assert.equal(zeile.app, 'boxenstopp');
  assert.equal(zeile.usd, 0.123457);
  assert.equal(zeile.nutzer, '00000000-0000-0000-0000-000000000000');
  assert.ok(!JSON.stringify(zeile).includes('sk-ant'), 'kein Schlüssel in der Tabelle');

  // Beim zweiten Mal fragt die Funktion Anthropic nicht noch einmal
  const abfragen = attrappe.modellAbfragen.length;
  assert.equal((await melde({ app: 'boxenstopp', modell: 'claude-opus-5-5', usd: 0.01 })).status, 204);
  assert.equal(attrappe.modellAbfragen.length, abfragen);
});

test('fremde Organisation, falscher oder fehlender Schlüssel: abgelehnt', async () => {
  const vorher = attrappe.kosten.length;
  assert.equal((await melde({ app: 'boxenstopp', modell: 'x', usd: 1 }, 'sk-ant-fremder-test')).status, 403);
  assert.equal((await melde({ app: 'boxenstopp', modell: 'x', usd: 1 }, 'sk-ant-gibtsnicht-123')).status, 401);
  assert.equal((await melde({ app: 'boxenstopp', modell: 'x', usd: 1 }, '')).status, 401);
  assert.equal(attrappe.kosten.length, vorher);
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
