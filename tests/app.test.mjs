/*
 * Die ganze App im Browser: anmelden, fragen, Antwort mitlesen, weiterfragen,
 * „Über mich“, neues Gespräch, Neuladen, Anhalten, Löschen, Abmelden, ein
 * nicht freigeschaltetes Konto und die schmale Ansicht.
 *
 * Dahinter laufen die echte Funktion amy-chat (mit Deno) und die Attrappe
 * statt Supabase und Anthropic.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, devices } from 'playwright';
import { NUTZER, starteAttrappe } from './attrappe.mjs';
import { starteFunktion } from './umgebung.mjs';
import { starteStatisch } from './statisch.mjs';

let attrappe;
let funktion;
let statisch;
let browser;
const konfig = {};

before(async () => {
  attrappe = await starteAttrappe();
  statisch = await starteStatisch({ konfig });
  funktion = await starteFunktion({
    attrappe: attrappe.url,
    erlaubt: [NUTZER['amy@test.de'].id, NUTZER['ich@test.de'].id],
    urspruenge: [statisch.url],
  });
  Object.assign(konfig, {
    supabaseUrl: attrappe.url,
    publishableKey: 'sb_publishable_test',
    funktionUrl: funktion.url,
  });
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await funktion?.schliessen();
  await statisch?.schliessen();
  await attrappe?.schliessen();
});

/* Ohne begruessen: true gilt das Gerät als schon begrüßt, damit die meisten
 * Tests gleich bei der Anmeldung anfangen. */
async function neueSeite({ begruessen = false, ...optionen } = {}) {
  const kontext = await browser.newContext({ viewport: { width: 1200, height: 820 }, ...optionen });
  if (!begruessen) {
    await kontext.addInitScript(() => localStorage.setItem('fragmal.begruesst', '1'));
  }
  const seite = await kontext.newPage();
  const fehler = [];
  seite.on('pageerror', (e) => fehler.push(String(e)));
  seite.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) fehler.push(m.text());
  });
  seite.on('dialog', (d) => d.accept());
  await seite.goto(`${statisch.url}/`);
  return { seite, kontext, fehler };
}

/* Meldet an und überspringt die Einführung, falls sie kommt. Mit
 * einfuehrung: true bleibt sie stehen. */
async function melde(seite, email, passwort, { einfuehrung = false } = {}) {
  await seite.fill('input[name=email]', email);
  await seite.fill('input[name=passwort]', passwort);
  await seite.$eval('#anmeldeform .meldung', (el) => { el.textContent = ''; });
  await seite.click('#anmeldeform button[type=submit]');
  // Entweder eine Fehlermeldung oder die fertig gezeichnete App
  await seite.waitForSelector('.meldung:not(:empty), #verlauf > *');
  if (!einfuehrung && await seite.locator('.einf').count()) {
    await seite.click('.einf [data-einf=ende]');
    await seite.waitForSelector('.einf', { state: 'detached' });
  }
}

let gezaehlt = 0;

async function frage(seite, text) {
  gezaehlt = attrappe.anfragen.length;
  await seite.fill('#frage', text);
  await seite.press('#frage', 'Enter');
}

/* Wartet, bis die Anfrage bei der Attrappe war und die App die Antwort fertig
 * gezeichnet hat. Nur auf das Verschwinden von #laufend zu warten reicht
 * nicht: Direkt nach dem Senden ist es noch gar nicht da. */
async function warteAufAntwort(seite) {
  for (let i = 0; i < 200 && attrappe.anfragen.length <= gezaehlt; i++) await seite.waitForTimeout(25);
  assert.ok(attrappe.anfragen.length > gezaehlt, 'keine Anfrage bei der Attrappe angekommen');
  const eintrag = attrappe.anfragen.at(-1);
  for (let i = 0; i < 400 && !eintrag.fertig && !eintrag.abgebrochen; i++) await seite.waitForTimeout(25);
  await seite.waitForSelector('#laufend', { state: 'detached' });
}

test('der ganze Weg mit einem freigeschalteten Konto', async () => {
  const { seite, kontext, fehler } = await neueSeite();

  // Falsches Passwort
  await melde(seite, 'amy@test.de', 'falsch');
  await seite.waitForSelector('.meldung:has-text("E-Mail oder Passwort stimmt nicht.")');

  // Richtig
  await melde(seite, 'amy@test.de', 'geheim-amy');
  await seite.waitForSelector('.leer h2:has-text("Worüber möchtest du reden?")');

  // Erste Frage
  const start = attrappe.anfragen.length;
  await frage(seite, 'Hallo, wer bist du?');
  await seite.waitForSelector('.von-mir .blase:has-text("Hallo, wer bist du?")');
  await warteAufAntwort(seite);
  const antwort1 = seite.locator('.von-claude .md').last();
  assert.equal(await antwort1.locator('strong').innerText(), 'wichtig');
  assert.equal(await antwort1.locator('li').count(), 2);
  assert.match(await antwort1.innerText(), /Du hast gefragt: Hallo, wer bist du\?/);
  assert.equal(await seite.locator('.eintrag').count(), 1);
  assert.equal(await seite.locator('#titel').innerText(), 'Hallo, wer bist du?');
  const a1 = attrappe.anfragen[start];
  assert.deepEqual(a1.koerper.messages, [{ role: 'user', content: 'Hallo, wer bist du?' }]);
  assert.doesNotMatch(a1.koerper.system[0].text, /ueber_mich/);

  // „Über mich“ eintragen
  await seite.click('button:has-text("Über mich & Einstellungen")');
  await seite.fill('#ueber-mich', 'Ich heiße Amy und mag kurze Antworten.');
  await seite.click('button:has-text("Speichern")');
  await seite.waitForSelector('.gespeichert:has-text("Gespeichert")');
  assert.match(await seite.locator('#einstellungen').innerText(), /Diesen Monat auf diesem Gerät: unter 1 Cent|Diesen Monat auf diesem Gerät: 0,01/);
  await seite.click('#einstellungen button[value=zu]');

  // Zweite Frage im selben Gespräch: alles davor geht unverändert mit,
  // auch der Systemtext (das neue „Über mich“ gilt erst für neue Gespräche).
  await frage(seite, 'Und noch was');
  await warteAufAntwort(seite);
  const a2 = attrappe.anfragen.at(-1);
  assert.equal(a2.koerper.system[0].text, a1.koerper.system[0].text);
  assert.equal(a2.koerper.messages.length, 3);
  assert.deepEqual(a2.koerper.messages[0], a1.koerper.messages[0]);
  assert.equal(a2.koerper.messages[1].role, 'assistant');
  assert.deepEqual(a2.koerper.messages[1].content[0], { type: 'thinking', thinking: '', signature: `sig-${a1.nr}` });
  assert.equal(a2.koerper.messages[1].content[1].type, 'text');
  assert.match(a2.koerper.messages[1].content[1].text, /^Antwort \d+: Das ist \*\*wichtig\*\*\./);
  assert.deepEqual(a2.koerper.messages[2], { role: 'user', content: 'Und noch was' });

  // Neues Gespräch: jetzt mit „Über mich“
  await seite.click('.leiste .knopf-neu');
  await seite.waitForSelector('.leer');
  await frage(seite, 'Neues Thema');
  await warteAufAntwort(seite);
  const a3 = attrappe.anfragen.at(-1);
  assert.match(a3.koerper.system[0].text, /<ueber_mich>\nIch heiße Amy und mag kurze Antworten\.\n<\/ueber_mich>/);
  assert.equal(a3.koerper.messages.length, 1);
  assert.equal(await seite.locator('.eintrag').count(), 2);

  // Neu laden: angemeldet, Gespräche noch da
  await seite.reload();
  await seite.waitForSelector('.eintrag');
  assert.equal(await seite.locator('.eintrag').count(), 2);
  await seite.click('.eintrag-knopf:has-text("Hallo, wer bist du?")');
  await seite.waitForSelector('.von-mir .blase:has-text("Und noch was")');
  assert.equal(await seite.locator('.nachricht').count(), 4);

  // Abgelaufenes Token wird still erneuert
  await seite.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('fragmal.sitzung'));
    s.ablauf = 0;
    s.zugang = 'tok-abgelaufen';
    localStorage.setItem('fragmal.sitzung', JSON.stringify(s));
  });
  await seite.reload();
  await seite.click('.eintrag-knopf:has-text("Hallo, wer bist du?")');

  // HTML in einer Antwort wird nicht ausgeführt
  await frage(seite, 'xss bitte');
  await warteAufAntwort(seite);
  const letzte = seite.locator('.von-claude .md').last();
  assert.match(await letzte.innerText(), /<img src=x/);
  assert.equal(await letzte.locator('img, script').count(), 0);
  assert.equal(await seite.evaluate(() => window.__xss), undefined);

  // Anhalten mitten in der Antwort
  await frage(seite, 'bitte langsam');
  await seite.waitForSelector('#laufend .md:has-text("Wort3")');
  assert.equal(await seite.getAttribute('#senden', 'aria-label'), 'Antwort anhalten');
  await seite.click('#senden');
  await warteAufAntwort(seite);
  const angehalten = await seite.locator('.von-claude .md').last().innerText();
  assert.match(angehalten, /Wort3/);
  assert.doesNotMatch(angehalten, /Wort199/);
  const langsam = attrappe.anfragen.at(-1);
  for (let i = 0; i < 50 && !langsam.abgebrochen; i++) await seite.waitForTimeout(100);
  assert.equal(langsam.abgebrochen, true);
  assert.equal(await seite.getAttribute('#senden', 'aria-label'), 'Senden');

  // Danach geht es normal weiter; die halbe Antwort steht als Text im Verlauf
  await frage(seite, 'weiter');
  await warteAufAntwort(seite);
  const a4 = attrappe.anfragen.at(-1);
  const vorletzte = a4.koerper.messages.at(-2);
  assert.equal(vorletzte.role, 'assistant');
  assert.equal(vorletzte.content.length, 1);
  assert.equal(vorletzte.content[0].type, 'text');
  assert.match(vorletzte.content[0].text, /^Wort0 Wort1 /);
  assert.equal(a4.koerper.system[0].text, a1.koerper.system[0].text);

  // Kopieren
  await kontext.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seite.locator('.von-claude .werkzeuge button').last().click();
  await seite.waitForSelector('.werkzeuge button:has-text("Kopiert")');
  assert.match(await seite.evaluate(() => navigator.clipboard.readText()), /Du hast gefragt: weiter/);

  // Löschen
  await seite.hover('.eintrag:has-text("Neues Thema")');
  await seite.click('.eintrag:has-text("Neues Thema") .eintrag-weg');
  await seite.waitForFunction(() => document.querySelectorAll('.eintrag').length === 1);

  // Löschen, während die Antwort noch läuft: Das Gespräch kommt nicht zurück
  await seite.click('.leiste .knopf-neu');
  await frage(seite, 'langsam und dann weg');
  await seite.waitForSelector('#laufend .md:has-text("Wort3")');
  await seite.hover('.eintrag:has-text("langsam und dann weg")');
  await seite.click('.eintrag:has-text("langsam und dann weg") .eintrag-weg');
  await seite.waitForFunction(() => document.querySelectorAll('.eintrag').length === 1);
  await seite.waitForTimeout(300);
  await seite.reload();
  await seite.waitForSelector('.eintrag');
  assert.equal(await seite.locator('.eintrag').count(), 1);

  // Abmelden, während eine Antwort läuft: kein Skriptfehler
  await seite.click('.eintrag-knopf');
  await frage(seite, 'noch einmal langsam');
  await seite.waitForSelector('#laufend .md:has-text("Wort3")');
  await seite.click('button:has-text("Über mich & Einstellungen")');
  await seite.click('#einstellungen button:has-text("Abmelden")');
  await seite.waitForSelector('#anmeldeform');
  await seite.waitForTimeout(300);
  await melde(seite, 'amy@test.de', 'geheim-amy');
  await seite.waitForSelector('.eintrag');

  // Abmelden
  await seite.click('button:has-text("Über mich & Einstellungen")');
  await seite.click('#einstellungen button:has-text("Abmelden")');
  await seite.waitForSelector('#anmeldeform');
  assert.equal(await seite.evaluate(() => localStorage.getItem('fragmal.sitzung')), null);

  assert.deepEqual(fehler, []);
  await kontext.close();
});

test('nicht freigeschaltetes Konto sieht eine klare Meldung und keine fremden Gespräche', async () => {
  const { seite, kontext, fehler } = await neueSeite();
  // Erst Amy, damit auf diesem Gerät ein Gespräch von ihr liegt
  await melde(seite, 'amy@test.de', 'geheim-amy');
  await seite.waitForSelector('.leer');
  await frage(seite, 'Amys Frage');
  await warteAufAntwort(seite);
  await seite.click('button:has-text("Über mich & Einstellungen")');
  await seite.click('#einstellungen button:has-text("Abmelden")');

  const vorher = attrappe.anfragen.length;
  await melde(seite, 'gast@test.de', 'geheim-gast');
  await seite.waitForSelector('.leer');
  assert.equal(await seite.locator('.eintrag').count(), 0);
  await frage(seite, 'Hallo');
  await seite.waitForSelector('.hinweis.fehler:has-text("Dieses Konto ist für die App nicht freigeschaltet.")');
  assert.equal(await seite.locator('.hinweis button:has-text("Nochmal versuchen")').count(), 1);
  assert.equal(attrappe.anfragen.length, vorher);
  assert.equal(await seite.locator('.eintrag').count(), 1);
  assert.deepEqual(fehler, []);
  await kontext.close();
});

test('schmale Ansicht: Liste als Schublade', async () => {
  const { seite, kontext, fehler } = await neueSeite({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await melde(seite, 'ich@test.de', 'geheim-ich');
  await seite.waitForSelector('.leer');
  assert.equal(await seite.isVisible('#leiste'), false);
  await seite.click('[data-act=leiste]');
  await seite.waitForFunction(() => getComputedStyle(document.querySelector('#leiste')).transform === 'none');
  assert.equal(await seite.isVisible('#leiste .knopf-neu'), true);
  await seite.click('.schleier', { position: { x: 370, y: 400 } });
  await seite.waitForFunction(() => !document.body.classList.contains('leiste-offen'));

  // Auf dem Handy macht Enter eine neue Zeile; gesendet wird mit dem Knopf
  await seite.fill('#frage', 'Zeile eins');
  await seite.press('#frage', 'Enter');
  assert.equal(await seite.locator('.nachricht').count(), 0);
  await seite.click('#senden');
  await warteAufAntwort(seite);
  assert.equal(await seite.locator('.von-claude').count(), 1);
  const breite = await seite.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(breite <= 390, `waagerecht scrollbar: ${breite}`);
  assert.deepEqual(fehler, []);
  await kontext.close();
});

test('Einführung: Begrüßung, Home-Bildschirm, erste Anmeldung, „Über mich“', async () => {
  const { seite, kontext, fehler } = await neueSeite({ ...devices['iPhone 13'], begruessen: true });
  const titel = () => seite.locator('.einf h2').innerText();

  // Vor der Anmeldung: Begrüßung und, auf dem iPhone, der Home-Bildschirm
  await seite.waitForSelector('.einf');
  assert.equal(await titel(), 'Hallo!');
  assert.equal(await seite.locator('.einf-punkte span').count(), 2);
  await seite.click('.einf [data-einf=weiter]');
  assert.equal(await titel(), 'Leg dir die App auf den Home-Bildschirm');
  assert.match(await seite.locator('.einf-inhalt').innerText(), /Zum Home-Bildschirm/);
  await seite.click('.einf button:has-text("Im Browser weiter")');
  await seite.waitForSelector('#anmeldeform');

  // Beim nächsten Öffnen kommt die Begrüßung nicht wieder
  await seite.reload();
  await seite.waitForSelector('#anmeldeform');
  assert.equal(await seite.locator('.einf').count(), 0);

  // Nach der ersten Anmeldung: vier Seiten, Zurück behält das Eingetragene
  await melde(seite, 'amy@test.de', 'geheim-amy', { einfuehrung: true });
  await seite.waitForSelector('.einf');
  assert.equal(await titel(), 'Schön, dass du da bist!');
  assert.equal(await seite.locator('.einf [data-einf=zurueck]').count(), 0);
  await seite.click('.einf [data-einf=weiter]');
  assert.equal(await titel(), 'So funktioniert’s');
  await seite.click('.einf [data-einf=zurueck]');
  assert.equal(await titel(), 'Schön, dass du da bist!');
  await seite.click('.einf [data-einf=weiter]');
  await seite.click('.einf [data-einf=weiter]');
  assert.equal(await titel(), 'Gut zu wissen');
  await seite.click('.einf [data-einf=weiter]');
  assert.equal(await titel(), 'Erzähl Claude ein bisschen über dich');
  assert.equal(await seite.locator('.einf [data-einf=ende]').count(), 0);
  await seite.fill('#einf-ueber-mich', 'Ich heiße Amy.');
  await seite.click('.einf [data-einf=zurueck]');
  await seite.click('.einf [data-einf=weiter]');
  assert.equal(await seite.inputValue('#einf-ueber-mich'), 'Ich heiße Amy.');
  await seite.click('.einf button:has-text("Los geht’s")');
  await seite.waitForSelector('.einf', { state: 'detached' });

  // Leeres Gespräch mit Beispielen; ein Beispiel füllt nur das Feld
  assert.equal(await seite.locator('.beispiel').count(), 4);
  const vorher = attrappe.anfragen.length;
  await seite.locator('.beispiel').first().click();
  assert.equal(await seite.inputValue('#frage'), 'Was kann ich heute mit Nudeln, Spinat und Feta kochen?');
  assert.equal(attrappe.anfragen.length, vorher);
  gezaehlt = vorher;
  await seite.click('#senden');
  await warteAufAntwort(seite);
  assert.match(attrappe.anfragen.at(-1).koerper.system[0].text, /<ueber_mich>\nIch heiße Amy\.\n<\/ueber_mich>/);

  // Nach dem Neuladen keine Einführung mehr (die Liste liegt in der
  // geschlossenen Schublade, deshalb nur „vorhanden“, nicht „sichtbar“)
  await seite.reload();
  await seite.waitForSelector('.eintrag', { state: 'attached' });
  assert.equal(await seite.locator('.einf').count(), 0);

  // Aus den Einstellungen noch einmal, mit dem gespeicherten „Über mich“
  await seite.click('[data-act=leiste]');
  await seite.click('.leiste-fuss [data-act=einstellungen]');
  await seite.click('#einstellungen button:has-text("Einführung ansehen")');
  await seite.waitForSelector('.einf');
  for (let i = 0; i < 3; i++) await seite.click('.einf [data-einf=weiter]');
  assert.equal(await seite.inputValue('#einf-ueber-mich'), 'Ich heiße Amy.');
  await seite.click('.einf [data-einf=zurueck]');
  await seite.click('.einf [data-einf=ende]');
  await seite.waitForSelector('.einf', { state: 'detached' });

  assert.deepEqual(fehler, []);
  await kontext.close();
});

test('Berater: der verschlüsselte Rat geht in der nächsten Frage unverändert mit', async () => {
  const { seite, kontext, fehler } = await neueSeite();
  await melde(seite, 'ich@test.de', 'geheim-ich');
  await frage(seite, 'Frag den Berater');
  await warteAufAntwort(seite);
  const erste = attrappe.anfragen.at(-1);
  await frage(seite, 'Danke');
  await warteAufAntwort(seite);
  const zweite = attrappe.anfragen.at(-1).koerper;
  const antwort = zweite.messages[1];
  assert.equal(antwort.role, 'assistant');
  assert.deepEqual(antwort.content.map((b) => b.type), ['thinking', 'server_tool_use', 'advisor_tool_result', 'text']);
  assert.equal(antwort.content[2].content.encrypted_content, `enc-${erste.nr}`);
  assert.deepEqual(zweite.tools, erste.koerper.tools);
  assert.equal(zweite.system[0].text, erste.koerper.system[0].text);
  // Die Kosten rechnen Fable mit. Erste Antwort: Opus 1000·4 + 2000·0,2 + 500·20
  // = 14.400 µ$, Fable 3000·8 + 800·40 = 56.000 µ$; zweite nur Opus 14.400 µ$.
  // Zusammen 84.800 µ$ ≈ 0,08 $ (ohne Fable wären es 0,03 $).
  await seite.click('.leiste-fuss [data-act=einstellungen]');
  assert.match(await seite.locator('#einstellungen').innerText(), /auf diesem Gerät: 0,08[\s ]\$/);
  assert.deepEqual(fehler, []);
  await kontext.close();
});

test('Frage ohne Antwort: Hinweis nach dem Neuladen, und nach dem Hintergrund wird nachgefragt', async () => {
  const { seite, kontext, fehler } = await neueSeite();
  await melde(seite, 'amy@test.de', 'geheim-amy');

  // Die App wird mitten in der Antwort neu geladen (so wie ein iPhone eine App im Hintergrund beendet)
  await frage(seite, 'Bitte langsam, dann neu laden');
  await seite.waitForSelector('#laufend .md:has-text("Wort3")');
  await seite.reload();
  await seite.click('.eintrag-knopf:has-text("Bitte langsam, dann neu laden")');
  await seite.waitForSelector('.hinweis.fehler:has-text("Darauf ist keine Antwort angekommen.")');
  gezaehlt = attrappe.anfragen.length;
  await seite.click('.hinweis button:has-text("Nochmal versuchen")');
  await warteAufAntwort(seite);
  assert.equal(await seite.locator('.von-claude').count(), 1);
  assert.equal(await seite.locator('.hinweis').count(), 0);

  // Die App geht in den Hintergrund, die Verbindung reißt ab – beim Zurückkommen fragt sie selbst nochmal
  const sichtbar = (versteckt) => seite.evaluate((v) => {
    Object.defineProperty(document, 'hidden', { value: v, configurable: true });
    Object.defineProperty(document, 'visibilityState', { value: v ? 'hidden' : 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, versteckt);
  await seite.click('.leiste .knopf-neu');
  await sichtbar(true);
  const vorher = attrappe.anfragen.length;
  // Das Handy kappt die Verbindung der App (nicht die des Servers): die erste Anfrage geht ins Leere
  await seite.route(konfig.funktionUrl, (r) => r.abort('connectionreset'), { times: 1 });
  await seite.fill('#frage', 'Bitte abreißen');
  await seite.press('#frage', 'Enter');
  await seite.waitForSelector('.hinweis:has-text("Die App war im Hintergrund")');
  assert.equal(attrappe.anfragen.length, vorher);
  gezaehlt = attrappe.anfragen.length;
  await sichtbar(false);
  await warteAufAntwort(seite);
  assert.equal(attrappe.anfragen.length, vorher + 1);
  assert.match(await seite.locator('.von-claude .md').last().innerText(), /Du hast gefragt: Bitte abreißen/);
  assert.equal(await seite.locator('.hinweis').count(), 0);

  assert.deepEqual(fehler, []);
  await kontext.close();
});

test('Einführung am Rechner: ohne Home-Bildschirm-Seite', async () => {
  const { seite, kontext, fehler } = await neueSeite({ begruessen: true });
  await seite.waitForSelector('.einf');
  assert.equal(await seite.locator('.einf h2').innerText(), 'Hallo!');
  assert.equal(await seite.locator('.einf-punkte span').count(), 0);
  await seite.click('.einf button:has-text("Zur Anmeldung")');
  await seite.waitForSelector('#anmeldeform');
  assert.deepEqual(fehler, []);
  await kontext.close();
});
