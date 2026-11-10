/*
 * Die Oberfläche: Anmeldung, Gesprächsliste, Gespräch, Einstellungen.
 *
 * Ablauf einer Frage: Die Nachricht kommt ins Gespräch und wird gespeichert,
 * dann geht das ganze Gespräch an die Funktion amy-chat. Die Antwort
 * erscheint, während sie entsteht. Ist sie fertig, kommt sie so ins
 * Gespräch, wie die API sie zurückgibt, mit allen Blöcken. Frühere
 * Nachrichten werden nie verändert; das Gespräch wächst nur hinten.
 */

import { anmelden, abmelden, gueltigesToken, sitzung } from './auth.js';
import { Abbruch, frage, textAus } from './api.js';
import { markdownZuHtml, maskiere } from './markdown.js';
import { alsDollar, kostenUSD } from './kosten.js';
import * as speicher from './store.js';

export const FASSUNG = '1';

const app = document.getElementById('app');
const grob = matchMedia('(pointer: coarse)').matches;

const zustand = {
  gespraeche: [],
  aktuell: null, // offenes Gespräch; null heißt: neues, noch leeres
  laeufe: new Map(), // Gespräch-ID → { ctrl, text, denkt }, solange eine Antwort entsteht
  hinweis: null, // { id, text, nochmal }
  ueberMich: '',
};

const $ = (sel) => app.querySelector(sel);

function nutzerId() {
  return sitzung()?.nutzer?.id;
}

function heute() {
  return new Date().toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function kurzesDatum(ms) {
  const d = new Date(ms);
  const jetzt = new Date();
  const tage = Math.round((new Date(jetzt.toDateString()) - new Date(d.toDateString())) / 86_400_000);
  if (tage === 0) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (tage === 1) return 'gestern';
  if (tage < 7) return d.toLocaleDateString('de-DE', { weekday: 'long' });
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}

function titelAus(text) {
  const eine = text.replace(/\s+/g, ' ').trim();
  return eine.length > 48 ? `${eine.slice(0, 46).trimEnd()} …` : eine;
}

function neueId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/* ---------- Anmeldung ---------- */

function zeigeAnmeldung(meldung = '') {
  document.title = 'Frag mal';
  app.innerHTML = `
    <main class="anmeldung">
      <div class="anmeldung-in">
        <img src="icon.svg" alt="" class="anmeldung-logo" width="72" height="72">
        <h1>Frag mal</h1>
        <p class="unter">Melde dich mit dem Konto an, das für dich angelegt wurde.</p>
        <form id="anmeldeform" novalidate>
          <label>E-Mail
            <input type="email" name="email" autocomplete="username" required inputmode="email" autocapitalize="off">
          </label>
          <label>Passwort
            <input type="password" name="passwort" autocomplete="current-password" required>
          </label>
          <button type="submit" class="knopf-haupt">Anmelden</button>
          <p class="meldung" role="alert">${maskiere(meldung)}</p>
        </form>
      </div>
    </main>`;
  const form = $('#anmeldeform');
  form.email.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const knopf = form.querySelector('button');
    const meldungEl = form.querySelector('.meldung');
    const email = form.email.value.trim();
    const passwort = form.passwort.value;
    if (!email || !passwort) {
      meldungEl.textContent = 'Bitte E-Mail und Passwort eingeben.';
      return;
    }
    knopf.disabled = true;
    knopf.textContent = 'Melde an …';
    meldungEl.textContent = '';
    try {
      await anmelden(email, passwort);
      await zeigeApp();
    } catch (fehler) {
      meldungEl.textContent = fehler.message;
      knopf.disabled = false;
      knopf.textContent = 'Anmelden';
    }
  });
}

async function abgemeldet(meldung) {
  for (const lauf of zustand.laeufe.values()) lauf.ctrl.abort();
  await abmelden();
  Object.assign(zustand, { gespraeche: [], aktuell: null, laeufe: new Map(), hinweis: null, ueberMich: '' });
  zeigeAnmeldung(meldung);
}

/* ---------- Gerüst ---------- */

async function zeigeApp() {
  app.innerHTML = `
    <div class="rahmen">
      <aside class="leiste" id="leiste" aria-label="Gespräche">
        <div class="leiste-kopf">
          <button type="button" class="knopf-neu" data-act="neu">
            <span aria-hidden="true">＋</span> Neues Gespräch
          </button>
        </div>
        <nav class="liste" id="liste"></nav>
        <div class="leiste-fuss">
          <button type="button" class="knopf-leise" data-act="einstellungen">Über mich &amp; Einstellungen</button>
        </div>
      </aside>
      <div class="schleier" data-act="leiste-zu"></div>
      <main class="haupt">
        <header class="kopf">
          <button type="button" class="knopf-symbol nur-schmal" data-act="leiste" aria-label="Gespräche zeigen">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
          </button>
          <h1 class="titel" id="titel">Neues Gespräch</h1>
          <button type="button" class="knopf-symbol" data-act="neu" aria-label="Neues Gespräch">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>
        </header>
        <div class="verlauf" id="verlauf" aria-live="polite"></div>
        <form class="eingabe" id="eingabe">
          <div class="eingabe-in">
            <textarea id="frage" rows="1" placeholder="Schreib etwas …" aria-label="Nachricht"
              enterkeyhint="${grob ? 'enter' : 'send'}"></textarea>
            <button type="submit" class="knopf-senden" id="senden" aria-label="Senden">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>
            </button>
          </div>
        </form>
      </main>
    </div>
    <dialog id="einstellungen" class="dialog"></dialog>`;

  const id = nutzerId();
  const [gespraeche, ueberMich] = await Promise.all([
    speicher.gespraecheVon(id),
    speicher.holeEinstellung(id, 'ueberMich'),
  ]);
  zustand.gespraeche = gespraeche;
  zustand.ueberMich = ueberMich || '';
  zustand.aktuell = null;
  speicher.dauerhaftBitten();

  const feld = $('#frage');
  feld.addEventListener('input', () => passeHoeheAn(feld));
  feld.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !grob) {
      e.preventDefault();
      $('#eingabe').requestSubmit();
    }
  });
  $('#eingabe').addEventListener('submit', (e) => {
    e.preventDefault();
    const lauf = laufHier();
    if (lauf) {
      lauf.ctrl.abort();
      return;
    }
    const text = feld.value;
    if (!text.trim()) return;
    feld.value = '';
    passeHoeheAn(feld);
    senden(text);
  });

  zeichneListe();
  zeichneGespraech({ ansEnde: true });
  if (!grob) feld.focus();
}

function passeHoeheAn(feld) {
  feld.style.height = 'auto';
  feld.style.height = `${Math.min(feld.scrollHeight, 220)}px`;
}

/* ---------- Liste ---------- */

function zeichneListe() {
  const liste = $('#liste');
  if (!liste) return;
  if (!zustand.gespraeche.length) {
    liste.innerHTML = '<p class="liste-leer">Noch keine Gespräche.</p>';
    return;
  }
  liste.innerHTML = zustand.gespraeche.map((g) => `
    <div class="eintrag${g.id === zustand.aktuell?.id ? ' aktiv' : ''}">
      <button type="button" class="eintrag-knopf" data-act="oeffne" data-id="${g.id}">
        <span class="eintrag-titel">${maskiere(g.titel || 'Ohne Titel')}</span>
        <span class="eintrag-zeit">${kurzesDatum(g.geaendert)}</span>
      </button>
      <button type="button" class="eintrag-weg" data-act="loesche" data-id="${g.id}" aria-label="Gespräch löschen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>`).join('');
}

/* ---------- Gespräch ---------- */

function istIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function istInstalliert() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

function leererZustand() {
  const tipp = istIOS() && !istInstalliert()
    ? `<p class="tipp">Tipp: Über <strong>Teilen → Zum Home-Bildschirm</strong> wird daraus eine App.
       Dann löscht Safari die Gespräche auch nicht, wenn du sie eine Weile nicht nutzt.</p>`
    : '';
  const ueber = zustand.ueberMich.trim()
    ? ''
    : `<p class="tipp">Unter <button type="button" class="link" data-act="einstellungen">Über mich</button>
       kannst du Claude ein paar Dinge über dich mitgeben, die es in jedem neuen Gespräch weiß.</p>`;
  return `
    <div class="leer">
      <h2>Worüber möchtest du reden?</h2>
      <p>Frag, was du wissen willst, lass dir etwas erklären, schreiben oder durchdenken.</p>
      ${ueber}${tipp}
    </div>`;
}

function nachrichtHtml(n, index) {
  if (n.role === 'user') {
    const text = typeof n.content === 'string' ? n.content : textAus(n.content);
    return `<div class="nachricht von-mir"><div class="blase">${maskiere(text)}</div></div>`;
  }
  const text = textAus(n.content);
  return `
    <div class="nachricht von-claude">
      <div class="md">${markdownZuHtml(text)}</div>
      <div class="werkzeuge">
        <button type="button" class="knopf-klein" data-act="kopieren" data-index="${index}">Kopieren</button>
      </div>
    </div>`;
}

function laufHier() {
  return zustand.aktuell ? zustand.laeufe.get(zustand.aktuell.id) : undefined;
}

function laufendHtml(l) {
  if (!l.text) {
    return `<div class="nachricht von-claude laufend" id="laufend">
      <div class="denkt" role="status"><span></span><span></span><span></span>
      <em>${l.denkt ? 'denkt nach' : 'liest'}</em></div></div>`;
  }
  return `<div class="nachricht von-claude laufend" id="laufend"><div class="md">${markdownZuHtml(l.text)}</div></div>`;
}

function hinweisHtml() {
  const h = zustand.hinweis;
  return `<div class="hinweis${h.nochmal ? ' fehler' : ''}" role="alert">
    <p>${maskiere(h.text)}</p>
    ${h.nochmal ? '<button type="button" class="knopf-klein" data-act="nochmal">Nochmal versuchen</button>' : ''}
  </div>`;
}

function amEnde(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

function zeichneGespraech({ ansEnde = false } = {}) {
  const verlauf = $('#verlauf');
  if (!verlauf) return;
  const g = zustand.aktuell;
  const bleibUnten = ansEnde || amEnde(verlauf);
  $('#titel').textContent = g?.titel || 'Neues Gespräch';
  document.title = g?.titel ? `${g.titel} · Frag mal` : 'Frag mal';

  if (!g || !g.nachrichten.length) {
    verlauf.innerHTML = leererZustand();
  } else {
    let html = g.nachrichten.map(nachrichtHtml).join('');
    if (zustand.laeufe.has(g.id)) html += laufendHtml(zustand.laeufe.get(g.id));
    if (zustand.hinweis?.id === g.id) html += hinweisHtml();
    verlauf.innerHTML = `<div class="verlauf-in">${html}</div>`;
  }
  zeichneSendeknopf();
  if (bleibUnten) verlauf.scrollTop = verlauf.scrollHeight;
}

let geplant = false;
function zeichneLaufendBald() {
  if (geplant) return;
  geplant = true;
  requestAnimationFrame(() => {
    geplant = false;
    const el = $('#laufend');
    const verlauf = $('#verlauf');
    const lauf = laufHier();
    if (!el || !lauf) return;
    const bleibUnten = amEnde(verlauf);
    el.outerHTML = laufendHtml(lauf);
    if (bleibUnten) verlauf.scrollTop = verlauf.scrollHeight;
  });
}

function zeichneSendeknopf() {
  const knopf = $('#senden');
  if (!knopf) return;
  const laeuftHier = laufHier();
  knopf.classList.toggle('stopp', Boolean(laeuftHier));
  knopf.setAttribute('aria-label', laeuftHier ? 'Antwort anhalten' : 'Senden');
  knopf.innerHTML = laeuftHier
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
}

function neuesGespraech() {
  return {
    id: neueId(),
    nutzer: nutzerId(),
    titel: '',
    erstellt: Date.now(),
    geaendert: Date.now(),
    // Wird hier festgehalten und danach nie mehr geändert (siehe store.js).
    kontext: { ueberMich: zustand.ueberMich, datum: heute() },
    nachrichten: [],
    verbrauch: [],
  };
}

async function merke(g) {
  g.geaendert = Date.now();
  await speicher.speichereGespraech(g);
  const rest = zustand.gespraeche.filter((x) => x.id !== g.id);
  zustand.gespraeche = [g, ...rest];
  zeichneListe();
}

async function senden(text) {
  let g = zustand.aktuell;
  if (!g) {
    g = neuesGespraech();
    zustand.aktuell = g;
  }
  if (zustand.laeufe.has(g.id)) return;
  if (zustand.hinweis?.id === g.id) zustand.hinweis = null;
  g.nachrichten.push({ role: 'user', content: text });
  if (!g.titel) g.titel = titelAus(text);
  await merke(g);
  await antwortHolen(g);
}

/* Gibt es das Gespräch noch? Es kann gelöscht worden sein, während die
 * Antwort lief, oder die Person hat sich abgemeldet. Dann nicht speichern,
 * sonst käme es zurück. */
function gibtEs(g) {
  return g.nutzer === nutzerId() && zustand.gespraeche.some((x) => x.id === g.id);
}

async function antwortHolen(g) {
  const lauf = { ctrl: new AbortController(), text: '', denkt: false };
  zustand.laeufe.set(g.id, lauf);
  zeichneGespraech({ ansEnde: true });

  let token;
  try {
    token = await gueltigesToken();
  } catch (fehler) {
    token = undefined;
    zustand.hinweis = { id: g.id, text: fehler.message, nochmal: true };
  }
  if (token === null) {
    await abgemeldet('Die Anmeldung ist abgelaufen. Bitte neu anmelden.');
    return;
  }

  if (token) {
    try {
      const fertig = await frage({
        token,
        kontext: g.kontext,
        nachrichten: g.nachrichten,
        signal: lauf.ctrl.signal,
        beiEreignis: (e) => {
          if (e.t === 'denkt') lauf.denkt = true;
          if (e.t === 'text') lauf.text += e.d;
          zeichneLaufendBald();
        },
      });
      if (Array.isArray(fertig.inhalt) && fertig.inhalt.length) {
        g.nachrichten.push({ role: 'assistant', content: fertig.inhalt });
      }
      g.verbrauch.push({ zeit: Date.now(), usd: kostenUSD(fertig.nutzung) });
      if (fertig.stop === 'max_tokens') {
        zustand.hinweis = { id: g.id, text: 'Die Antwort war zu lang und wurde abgeschnitten. Schreib „weiter“, dann setzt Claude fort.' };
      } else if (fertig.stop === 'refusal') {
        zustand.hinweis = { id: g.id, text: 'Diese Anfrage wurde aus Sicherheitsgründen nicht beantwortet.' };
      }
    } catch (fehler) {
      // Was bis dahin angekommen ist, bleibt als Antwort stehen.
      const teil = lauf.text.trim();
      if (teil) g.nachrichten.push({ role: 'assistant', content: [{ type: 'text', text: lauf.text }] });
      if (fehler.status === 401) {
        if (gibtEs(g)) await merke(g);
        await abgemeldet('Die Anmeldung ist abgelaufen. Bitte neu anmelden.');
        return;
      }
      if (!(fehler instanceof Abbruch)) {
        zustand.hinweis = { id: g.id, text: fehler.message, nochmal: !teil };
      }
    }
  }

  if (zustand.laeufe.get(g.id) === lauf) zustand.laeufe.delete(g.id);
  if (!gibtEs(g)) return;
  await merke(g);
  if (zustand.aktuell?.id === g.id) zeichneGespraech();
}

/* ---------- Einstellungen ---------- */

function verbrauchDiesenMonat() {
  const jetzt = new Date();
  const anfang = new Date(jetzt.getFullYear(), jetzt.getMonth(), 1).getTime();
  let summe = 0;
  for (const g of zustand.gespraeche) {
    for (const v of g.verbrauch || []) if (v.zeit >= anfang) summe += v.usd;
  }
  return summe;
}

function oeffneEinstellungen() {
  const dialog = $('#einstellungen');
  const s = sitzung();
  dialog.innerHTML = `
    <form method="dialog" class="einst">
      <div class="einst-kopf">
        <h2>Über mich</h2>
        <button value="zu" class="knopf-symbol" aria-label="Schließen">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <p class="klein">Das bekommt Claude zu Beginn jedes <em>neuen</em> Gesprächs mit:
        etwa wie du heißt, was du machst, was dich interessiert oder wie du Antworten am liebsten hast.
        Laufende Gespräche behalten den Stand, mit dem sie angefangen haben.</p>
      <textarea id="ueber-mich" rows="7" maxlength="6000"
        placeholder="Ich heiße …, arbeite als … Ich mag kurze Antworten ohne viel Drumherum.">${maskiere(zustand.ueberMich)}</textarea>
      <div class="reihe">
        <button type="button" class="knopf-haupt" data-act="ueber-mich-speichern">Speichern</button>
        <span class="gespeichert" role="status"></span>
      </div>

      <h3>Verbrauch</h3>
      <p>Diesen Monat auf diesem Gerät: <strong>${alsDollar(verbrauchDiesenMonat())}</strong>
        <span class="klein">(geschätzt)</span></p>

      <h3>Konto</h3>
      <p>Angemeldet als ${maskiere(s?.nutzer?.email || '')}</p>
      <button type="button" class="knopf-leise" data-act="abmelden">Abmelden</button>

      <p class="klein fuss">Die Gespräche liegen nur auf diesem Gerät. Für jede Antwort geht das
        Gespräch über den Server der App an Anthropic; der Server selbst speichert nichts.
        Modell: Claude Opus 5.5 · Fassung ${FASSUNG}</p>
    </form>`;
  dialog.showModal();
}

async function speichereUeberMich() {
  const feld = $('#ueber-mich');
  zustand.ueberMich = feld.value.trim();
  await speicher.setzeEinstellung(nutzerId(), 'ueberMich', zustand.ueberMich);
  const status = $('#einstellungen .gespeichert');
  status.textContent = 'Gespeichert. Gilt ab dem nächsten neuen Gespräch.';
  if (!zustand.aktuell?.nachrichten.length) zeichneGespraech();
}

/* ---------- Aktionen ---------- */

function leiste(offen) {
  document.body.classList.toggle('leiste-offen', offen);
}

app.addEventListener('click', async (e) => {
  const ziel = e.target.closest('[data-act]');
  if (!ziel) return;
  const akt = ziel.dataset.act;

  if (akt === 'leiste') leiste(true);
  if (akt === 'leiste-zu') leiste(false);

  if (akt === 'neu') {
    zustand.aktuell = null;
    leiste(false);
    zeichneListe();
    zeichneGespraech({ ansEnde: true });
    $('#frage')?.focus();
  }

  if (akt === 'oeffne') {
    zustand.aktuell = zustand.gespraeche.find((g) => g.id === ziel.dataset.id) || null;
    leiste(false);
    zeichneListe();
    zeichneGespraech({ ansEnde: true });
  }

  if (akt === 'loesche') {
    const g = zustand.gespraeche.find((x) => x.id === ziel.dataset.id);
    if (!g || !confirm(`„${g.titel || 'Ohne Titel'}“ löschen?`)) return;
    // Erst aus der Liste, dann anhalten: So speichert die laufende Antwort
    // das Gespräch nicht wieder (siehe gibtEs).
    zustand.gespraeche = zustand.gespraeche.filter((x) => x.id !== g.id);
    zustand.laeufe.get(g.id)?.ctrl.abort();
    await speicher.loescheGespraech(g.id);
    if (zustand.aktuell?.id === g.id) zustand.aktuell = null;
    zeichneListe();
    zeichneGespraech();
  }

  if (akt === 'kopieren') {
    const n = zustand.aktuell?.nachrichten[Number(ziel.dataset.index)];
    if (!n) return;
    try {
      await navigator.clipboard.writeText(textAus(n.content));
      ziel.textContent = 'Kopiert';
      setTimeout(() => { ziel.textContent = 'Kopieren'; }, 1500);
    } catch {
      ziel.textContent = 'Ging nicht';
    }
  }

  if (akt === 'nochmal') {
    const g = zustand.aktuell;
    if (!g || zustand.laeufe.has(g.id)) return;
    zustand.hinweis = null;
    if (g.nachrichten[g.nachrichten.length - 1]?.role === 'user') await antwortHolen(g);
    else zeichneGespraech();
  }

  if (akt === 'einstellungen') {
    leiste(false);
    oeffneEinstellungen();
  }

  if (akt === 'ueber-mich-speichern') await speichereUeberMich();

  if (akt === 'abmelden') {
    $('#einstellungen')?.close();
    await abgemeldet('');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') leiste(false);
});

/* ---------- Start ---------- */

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

if (sitzung()) {
  zeigeApp().catch((fehler) => {
    console.error(fehler);
    app.innerHTML = `<main class="anmeldung"><div class="anmeldung-in"><h1>Frag mal</h1>
      <p>Der Speicher auf diesem Gerät ist nicht erreichbar. In einem privaten Fenster geht das nicht.</p>
      <p><a href="">Neu laden</a></p></div></main>`;
  });
} else {
  zeigeAnmeldung();
}
