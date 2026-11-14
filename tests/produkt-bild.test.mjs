/*
 * Die Funktion produkt-bild: das Hauptbild einer Produktseite für Boxenstopp
 * (wie eine Linkvorschau). Wer fragt, weist sich mit der Prüfsumme seines
 * Schlüssels aus wie bei api-kosten. Das „Internet“ ist die Attrappe (netz).
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { starteAttrappe } from './attrappe.mjs';
import { starteFunktion } from './umgebung.mjs';

const URSPRUNG = 'https://finanzdienste.github.io';
const summe = (s) => createHash('sha256').update(s).digest('hex');
const BOXENSTOPP = summe('sk-ant-boxenstopp-test');
const KENNUNG = 'Boxenstopp-Linkvorschau (+https://github.com/Finanzdienste/Boxenstopp)';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 200 }, (_, i) => i % 256)]);
const html = (kopf) => ({ status: 200, kopf: { 'Content-Type': 'text/html; charset=utf-8' }, koerper: `<!doctype html><html><head><title>Produkt</title>${kopf}</head><body><h1>Produkt</h1></body></html>` });
const bild = (typ, daten = JPEG) => ({ status: 200, kopf: { 'Content-Type': typ, 'Content-Length': String(daten.length) }, koerper: daten });
let attrappe;
let funktion;

before(async () => {
  attrappe = await starteAttrappe();
  const n = attrappe.netz;
  n.set('shop.example/p/schuhe', html('<meta content="/bilder/schuhe.jpg?v=1&amp;w=800" property="og:image"><meta name="twitter:image" content="https://cdn.example/t.png">'));
  n.set('shop.example/bilder/schuhe.jpg?v=1&w=800', bild('image/jpeg'));
  n.set('shop.example/p/jsonld', html(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite' }, { '@type': 'Product', name: 'X', image: [{ url: 'https://cdn.example/x.webp' }] }] })}</script>`));
  n.set('cdn.example/x.webp', bild('image/webp'));
  n.set('shop.example/p/twitter', html("<meta name='twitter:image' content='https://cdn.example/t.png'>"));
  n.set('cdn.example/t.png', bild('image/png'));
  n.set('shop.example/p/ohne', html('<meta name="description" content="nichts">'));
  n.set('shop.example/p/gesperrt', { status: 403, kopf: { 'Content-Type': 'text/html' }, koerper: 'Bitte beweisen Sie, dass Sie ein Mensch sind' });
  n.set('shop.example/kurz', { status: 301, kopf: { Location: '/p/schuhe' } });
  n.set('shop.example/p/intern-bild', html('<meta property="og:image" content="https://intern.example/a.jpg"><meta name="twitter:image" content="https://cdn.example/t.png">'));
  n.set('shop.example/p/gross', html('<meta property="og:image" content="https://cdn.example/gross.jpg">'));
  n.set('cdn.example/gross.jpg', bild('image/jpeg', Buffer.alloc(300_000, 1)));
  n.set('shop.example/p/pdf', { status: 200, kopf: { 'Content-Type': 'application/pdf' }, koerper: '%PDF-1.7' });
  n.set('shop.example/p/kein-bildtyp', html('<meta property="og:image" content="https://cdn.example/text.jpg">'));
  n.set('cdn.example/text.jpg', html(''));
  n.set('shop.example/p/weiter-intern', { status: 302, kopf: { Location: 'https://intern.example/p' } });
  funktion = await starteFunktion({ attrappe: attrappe.url, urspruenge: [URSPRUNG], datei: 'produkt-bild-lokal.ts', schluesselSummen: [BOXENSTOPP] });
});

after(async () => {
  await funktion?.schliessen();
  await attrappe?.schliessen();
});

const frage = (seite, kopf = { 'x-schluessel-hash': BOXENSTOPP }, koerper = JSON.stringify({ seite })) => fetch(funktion.url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: URSPRUNG, ...kopf },
  body: koerper,
});
const abrufe = (wo) => attrappe.netzAbrufe.filter((a) => a.wo === wo);

test('Vorabfrage: Prüfsumme und JSON erlaubt, nur POST', async () => {
  const a = await fetch(funktion.url, { method: 'OPTIONS', headers: { Origin: URSPRUNG } });
  assert.equal(a.status, 204);
  assert.equal(a.headers.get('access-control-allow-origin'), URSPRUNG);
  assert.match(a.headers.get('access-control-allow-headers'), /x-schluessel-hash/);
  assert.equal((await fetch(funktion.url)).status, 405);
});

test('ohne erlaubte Prüfsumme kein Bild – und es wird nichts geholt', async () => {
  const vorher = attrappe.netzAbrufe.length;
  assert.equal((await frage('https://shop.example/p/schuhe', {})).status, 401);
  assert.equal((await frage('https://shop.example/p/schuhe', { 'x-schluessel-hash': summe('sk-ant-fremd') })).status, 403);
  assert.equal(attrappe.netzAbrufe.length, vorher);
});

test('og:image (auch vertauscht, relativ, mit &amp;): das Bild kommt zurück – die Funktion nennt sich ehrlich', async () => {
  const a = await frage('https://shop.example/p/schuhe');
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await a.arrayBuffer()), JPEG);
  const seite = abrufe('shop.example/p/schuhe').at(-1);
  assert.equal(seite.kopf['user-agent'], KENNUNG);
  assert.match(seite.kopf.accept, /^text\/html/);
  assert.equal(abrufe('shop.example/bilder/schuhe.jpg?v=1&w=800').length, 1);
  assert.equal(abrufe('cdn.example/t.png').length, 0, 'das erste Bild reicht');
});

test('ohne og:image: das Bild aus dem Produkt-JSON-LD, sonst twitter:image', async () => {
  const j = await frage('https://shop.example/p/jsonld');
  assert.equal(j.status, 200);
  assert.equal(j.headers.get('content-type'), 'image/webp');
  const t = await frage('https://shop.example/p/twitter');
  assert.equal(t.status, 200);
  assert.equal(t.headers.get('content-type'), 'image/png');
});

test('eine Weiterleitung wird mitgegangen (und neu geprüft)', async () => {
  const a = await frage('https://shop.example/kurz');
  assert.equal(a.status, 200);
  assert.equal(abrufe('shop.example/kurz').length, 1);
});

test('kein Bild, keine HTML-Seite, kein Bildtyp, zu groß: 404', async () => {
  for (const s of ['ohne', 'pdf', 'kein-bildtyp', 'gross']) {
    assert.equal((await frage(`https://shop.example/p/${s}`)).status, 404, s);
  }
});

test('weist eine Seite ab: 502 – ohne zweiten Versuch mit anderen Köpfen', async () => {
  const vorher = abrufe('shop.example/p/gesperrt').length;
  assert.equal((await frage('https://shop.example/p/gesperrt')).status, 502);
  assert.equal(abrufe('shop.example/p/gesperrt').length, vorher + 1);
});

test('nur https und öffentliche Namen – nichts Internes, keine IP-Adressen, kein Rossmann', async () => {
  const vorher = attrappe.netzAbrufe.length;
  for (const s of ['http://shop.example/p/schuhe', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://localhost/x', 'https://drucker.local/x', 'https://shop.example:8443/x', 'https://ich:geheim@shop.example/x', 'https://www.rossmann.de/p/1', 'https://intern.example/p']) {
    assert.equal((await frage(s)).status, 422, s);
  }
  assert.equal(attrappe.netzAbrufe.length, vorher, 'davon wird nichts geholt');
  assert.equal((await frage('https://shop.example/p/weiter-intern')).status, 422, 'auch nicht über eine Weiterleitung');
  assert.equal(attrappe.netzAbrufe.some((a) => a.wo.startsWith('intern.example')), false);
});

test('ein Bild auf einer internen Adresse wird übersprungen – das nächste genommen', async () => {
  const a = await frage('https://shop.example/p/intern-bild');
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('content-type'), 'image/png');
  assert.equal(attrappe.netzAbrufe.some((x) => x.wo.startsWith('intern.example')), false);
});

test('Unsinn: 400', async () => {
  assert.equal((await frage('', undefined, 'kein json')).status, 400);
  assert.equal((await frage('keine adresse')).status, 400);
  assert.equal((await frage(`https://shop.example/${'x'.repeat(900)}`)).status, 400);
});
