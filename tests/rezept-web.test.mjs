/*
 * Die Funktion rezept-web: eine Rezeptseite lesen (JSON-LD, sonst Text) und
 * im Internet suchen (Tavily) – für Boxenstopp ohne Claude. Wer fragt, weist
 * sich mit der Prüfsumme seines Schlüssels aus wie bei produkt-bild. Das
 * „Internet“ und Tavily sind die Attrappe (netz).
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { starteAttrappe } from './attrappe.mjs';
import { starteFunktion } from './umgebung.mjs';

const URSPRUNG = 'https://finanzdienste.github.io';
const summe = (s) => createHash('sha256').update(s).digest('hex');
const ERLAUBT = summe('AQ.gemini-ersatz-test');
const KENNUNG = 'Boxenstopp-Rezeptleser (+https://github.com/Finanzdienste/Boxenstopp)';
const html = (kopf, rumpf = '<h1>Rezept</h1>') => ({ status: 200, kopf: { 'Content-Type': 'text/html; charset=utf-8' }, koerper: `<!doctype html><html><head><title>Testrezept &amp; mehr</title>${kopf}</head><body><nav>Menü</nav>${rumpf}<script>var x=1</script></body></html>` });
const REZEPT = {
  '@context': 'https://schema.org',
  '@graph': [{ '@type': 'WebPage' }, {
    '@type': ['Recipe'], name: 'Kürbis-Testcurry', recipeYield: ['4 Portionen'], totalTime: 'PT1H5M', image: { url: '/bild.jpg' },
    recipeIngredient: ['500 g Hokkaido', '1 Dose Kokosmilch', '2 EL Currypaste &amp; Salz'],
    recipeInstructions: [{ '@type': 'HowToSection', name: 'Vorbereiten', itemListElement: [{ '@type': 'HowToStep', text: 'Kürbis <b>würfeln</b>.' }] }, { '@type': 'HowToStep', text: 'Alles 20 Min. köcheln.' }],
  }],
};
let attrappe;
let funktion;

before(async () => {
  attrappe = await starteAttrappe();
  const n = attrappe.netz;
  n.set('blog.example/robots.txt', { status: 200, kopf: { 'Content-Type': 'text/plain' }, koerper: 'User-agent: *\nDisallow: /privat/\nAllow: /privat/offen\n\nUser-agent: Boxenstopp\nDisallow: /nicht-fuer-uns/\n' });
  n.set('blog.example/curry', html(`<script type="application/ld+json">${JSON.stringify(REZEPT)}</script>`));
  n.set('blog.example/ohne', html('', '<article><h1>Omas Eintopf</h1><p>Zutaten: 3 Kartoffeln&nbsp;und Möhren</p><p>Alles kochen.</p></article>'));
  n.set('blog.example/privat/geheim', html(''));
  n.set('blog.example/nicht-fuer-uns/x', html(''));
  n.set('blog.example/kurz', { status: 301, kopf: { Location: '/curry' } });
  n.set('blog.example/pdf', { status: 200, kopf: { 'Content-Type': 'application/pdf' }, koerper: '%PDF' });
  n.set('blog.example/weiter-intern', { status: 302, kopf: { Location: 'https://intern.example/p' } });
  // ohne robots.txt (404): alles erlaubt; robots.txt kaputt (500): lieber nicht
  n.set('frei.example/r', html(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'Frei', recipeIngredient: ['1 Ei'], recipeInstructions: 'Kochen.' })}</script>`));
  n.set('kaputt.example/robots.txt', { status: 500, kopf: {}, koerper: 'x' });
  n.set('kaputt.example/r', html(''));
  n.set('api.tavily.com/search', { status: 200, kopf: { 'Content-Type': 'application/json' }, koerper: JSON.stringify({ results: [{ title: 'Kürbiscurry – Lecker', url: 'https://lecker.example/kuerbis', content: 'Ein cremiges Curry', raw_content: 'Zutaten: Kürbis   Kokosmilch' }, { title: 'kaputt', url: 'javascript:alert(1)', content: 'x' }] }) });
  process.env.TAVILY_API_KEY = 'tvly-test-schluessel';
  funktion = await starteFunktion({ attrappe: attrappe.url, urspruenge: [URSPRUNG], datei: 'rezept-web-lokal.ts', schluesselSummen: [ERLAUBT] });
});

after(async () => {
  delete process.env.TAVILY_API_KEY;
  await funktion?.schliessen();
  await attrappe?.schliessen();
});

const frage = (eingabe, kopf = { 'x-schluessel-hash': ERLAUBT }) => fetch(funktion.url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: URSPRUNG, ...kopf },
  body: JSON.stringify(eingabe),
});
const abrufe = (wo) => attrappe.netzAbrufe.filter((a) => a.wo === wo);

test('Nur mit erlaubter Prüfsumme, nur POST', async () => {
  assert.equal((await fetch(funktion.url, { method: 'OPTIONS', headers: { Origin: URSPRUNG } })).status, 204);
  assert.equal((await frage({ art: 'seite', seite: 'https://blog.example/curry' }, {})).status, 401);
  assert.equal((await frage({ art: 'seite', seite: 'https://blog.example/curry' }, { 'x-schluessel-hash': summe('fremd') })).status, 403);
  assert.equal((await fetch(funktion.url, { method: 'GET' })).status, 405);
});

test('Rezeptseite: das Rezept aus dem JSON-LD, mit ehrlicher Kennung, robots.txt zuerst', async () => {
  const r = await frage({ art: 'seite', seite: 'https://blog.example/curry' });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.titel, 'Testrezept & mehr');
  assert.deepEqual(d.rezept, {
    name: 'Kürbis-Testcurry', zutaten: ['500 g Hokkaido', '1 Dose Kokosmilch', '2 EL Currypaste & Salz'],
    schritte: ['Kürbis würfeln.', 'Alles 20 Min. köcheln.'], portionen: 4, minuten: 65, bild: 'https://blog.example/bild.jpg',
  });
  assert.equal(abrufe('blog.example/robots.txt').length >= 1, true);
  assert.equal(abrufe('blog.example/curry')[0].kopf['user-agent'], KENNUNG);
});

test('Ohne JSON-LD: der sichtbare Text, ohne Navigation und Skripte', async () => {
  const d = await (await frage({ art: 'seite', seite: 'https://blog.example/ohne' })).json();
  assert.equal(d.rezept, null);
  assert.match(d.text, /Omas Eintopf/);
  assert.match(d.text, /3 Kartoffeln und Möhren/);
  assert.doesNotMatch(d.text, /Menü|var x/);
});

test('robots.txt: was sie verbietet, wird nicht geholt – auch für uns eigens', async () => {
  const r = await frage({ art: 'seite', seite: 'https://blog.example/nicht-fuer-uns/x' });
  assert.equal(r.status, 451);
  assert.equal(abrufe('blog.example/nicht-fuer-uns/x').length, 0);
  // Für Boxenstopp gilt die eigene Gruppe – /privat/ verbietet nur die für „*“
  assert.equal((await frage({ art: 'seite', seite: 'https://blog.example/privat/geheim' })).status, 200);
  assert.equal((await frage({ art: 'seite', seite: 'https://frei.example/r' })).status, 200, 'ohne robots.txt: erlaubt');
  assert.equal((await frage({ art: 'seite', seite: 'https://kaputt.example/r' })).status, 451, 'robots.txt geht nicht: lieber nicht');
  assert.equal(abrufe('kaputt.example/r').length, 0);
});

test('Weiterleitungen, Grenzen: nur https, nichts Internes, nur Webseiten, kein Rossmann', async () => {
  assert.equal((await (await frage({ art: 'seite', seite: 'https://blog.example/kurz' })).json()).rezept.name, 'Kürbis-Testcurry');
  assert.equal((await frage({ art: 'seite', seite: 'http://blog.example/curry' })).status, 422);
  assert.equal((await frage({ art: 'seite', seite: 'https://10.0.0.1/x' })).status, 422);
  assert.equal((await frage({ art: 'seite', seite: 'https://intern.example/x' })).status, 422);
  assert.equal((await frage({ art: 'seite', seite: 'https://blog.example/weiter-intern' })).status, 422);
  assert.equal((await frage({ art: 'seite', seite: 'https://www.rossmann.de/de/rezept' })).status, 422);
  assert.equal((await frage({ art: 'seite', seite: 'https://blog.example/pdf' })).status, 415);
  assert.equal((await frage({ art: 'seite', seite: 'kein link' })).status, 400);
  assert.equal((await frage({ art: 'nix' })).status, 400);
});

test('Suche: Tavily mit dem Schlüssel der Funktion, Ergebnisse bereinigt', async () => {
  const r = await frage({ art: 'suche', q: 'Kürbiscurry Rezept', max: 3, seiten: true });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.deepEqual(d.ergebnisse, [{ titel: 'Kürbiscurry – Lecker', url: 'https://lecker.example/kuerbis', text: 'Ein cremiges Curry\nZutaten: Kürbis Kokosmilch' }]);
  const a = abrufe('api.tavily.com/search').at(-1);
  assert.equal(a.kopf.authorization, 'Bearer tvly-test-schluessel');
  const k = JSON.parse(a.koerper);
  assert.equal(k.query, 'Kürbiscurry Rezept');
  assert.equal(k.max_results, 3);
  assert.equal(k.include_raw_content, 'text');
  assert.equal(k.search_depth, 'basic');
  assert.doesNotMatch(funktion.protokoll(), /Kürbiscurry Rezept/, 'die Suchanfrage steht nicht im Protokoll');
  assert.equal((await frage({ art: 'suche', q: '' })).status, 400);
});
