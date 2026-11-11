/*
 * Speicher auf dem Gerät (IndexedDB). Hier liegen die Gespräche und die
 * Einstellungen, getrennt nach Konto: Melden sich zwei Leute auf demselben
 * Gerät an, sieht jeder nur seine eigenen.
 *
 * Ein Gespräch:
 *
 *   id          zufällige Kennung
 *   nutzer      Konto, dem es gehört
 *   titel       Anfang der ersten Frage
 *   erstellt,   Zeitpunkte in Millisekunden
 *   geaendert
 *   kontext     „Über mich“ und Datum, festgehalten beim Anlegen. Bleibt
 *               danach unverändert, damit Claudes Systemtext im ganzen
 *               Gespräch derselbe ist.
 *   nachrichten die Nachrichten genau so, wie sie an die API gehen. Antworten
 *               werden mit allen Blöcken gespeichert, wie sie kommen, und nie
 *               nachträglich verändert.
 *   verbrauch   [{ zeit, usd }] je Antwort
 */

const NAME = 'fragmal';
const VERSION = 1;

let verbindung = null;

function db() {
  if (!verbindung) {
    verbindung = new Promise((gut, schlecht) => {
      const anfrage = indexedDB.open(NAME, VERSION);
      anfrage.onupgradeneeded = () => {
        const d = anfrage.result;
        const g = d.createObjectStore('gespraeche', { keyPath: 'id' });
        g.createIndex('nutzer', 'nutzer');
        d.createObjectStore('einstellungen');
      };
      anfrage.onsuccess = () => gut(anfrage.result);
      anfrage.onerror = () => schlecht(anfrage.error);
    });
  }
  return verbindung;
}

async function vorgang(speicher, modus, arbeit) {
  const d = await db();
  return new Promise((gut, schlecht) => {
    const t = d.transaction(speicher, modus);
    const anfrage = arbeit(t.objectStore(speicher));
    t.oncomplete = () => gut(anfrage?.result);
    t.onerror = () => schlecht(t.error);
    t.onabort = () => schlecht(t.error);
  });
}

export async function gespraecheVon(nutzer) {
  const alle = await vorgang('gespraeche', 'readonly', (s) => s.index('nutzer').getAll(nutzer));
  return (alle || []).sort((a, b) => b.geaendert - a.geaendert);
}

export function holeGespraech(id) {
  return vorgang('gespraeche', 'readonly', (s) => s.get(id));
}

export function speichereGespraech(gespraech) {
  return vorgang('gespraeche', 'readwrite', (s) => s.put(gespraech));
}

export function loescheGespraech(id) {
  return vorgang('gespraeche', 'readwrite', (s) => s.delete(id));
}

export function holeEinstellung(nutzer, name) {
  return vorgang('einstellungen', 'readonly', (s) => s.get(`${nutzer}:${name}`));
}

export function setzeEinstellung(nutzer, name, wert) {
  return vorgang('einstellungen', 'readwrite', (s) => s.put(wert, `${nutzer}:${name}`));
}

/* Bittet den Browser, die Daten nicht von selbst zu löschen, wenn der
 * Speicher knapp wird. Ob er zustimmt, entscheidet er. */
export async function dauerhaftBitten() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch {
    // egal
  }
}
