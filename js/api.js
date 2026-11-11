/*
 * Schickt ein Gespräch an die Funktion amy-chat und liest die Antwort mit,
 * während sie entsteht.
 *
 * Die Funktion antwortet mit Server-Sent Events. Jedes Ereignis ist eine
 * Zeile „data: {…}“ mit einem dieser Typen:
 *
 *   denkt    Claude denkt nach (es kommt noch kein Text)
 *   text     ein Stück Antworttext
 *   fertig   die vollständige Antwort, so wie die API sie zurückgibt
 *   fehler   etwas ist schiefgegangen
 */

import { KONFIG } from './config.js';

/* Zerlegt den bisher angekommenen Text in fertige Ereignisse. Was noch nicht
 * vollständig da ist, bleibt als Rest für das nächste Stück. */
export function zerlegeSSE(puffer) {
  const ereignisse = [];
  let rest = puffer.replace(/\r\n/g, '\n');
  let ende;
  while ((ende = rest.indexOf('\n\n')) !== -1) {
    const block = rest.slice(0, ende);
    rest = rest.slice(ende + 2);
    const daten = block
      .split('\n')
      .filter((z) => z.startsWith('data:'))
      .map((z) => z.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!daten) continue;
    try {
      ereignisse.push(JSON.parse(daten));
    } catch {
      // Kaputte Zeile überspringen, der Rest kann trotzdem stimmen.
    }
  }
  return { ereignisse, rest };
}

export class Abbruch extends Error {}

export async function frage({ token, kontext, nachrichten, signal, beiEreignis }) {
  let antwort;
  try {
    antwort = await fetch(KONFIG.funktionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: KONFIG.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ kontext, nachrichten }),
      signal,
    });
  } catch (fehler) {
    if (signal?.aborted) throw new Abbruch('abgebrochen');
    throw new Error('Keine Verbindung. Bist du online?');
  }

  if (!antwort.ok) {
    let text = `Der Server antwortet mit Fehler ${antwort.status}.`;
    try {
      const daten = await antwort.json();
      text = daten.fehler || daten.msg || daten.message || text;
    } catch {
      // kein JSON, dann bleibt die allgemeine Meldung
    }
    const fehler = new Error(text);
    fehler.status = antwort.status;
    throw fehler;
  }

  const leser = antwort.body.getReader();
  const dekodierer = new TextDecoder();
  let puffer = '';
  let fertig = null;
  try {
    for (;;) {
      const { value, done } = await leser.read();
      if (done) break;
      puffer += dekodierer.decode(value, { stream: true });
      const { ereignisse, rest } = zerlegeSSE(puffer);
      puffer = rest;
      for (const e of ereignisse) {
        if (e.t === 'fehler') throw new Error(e.text || 'Unbekannter Fehler.');
        if (e.t === 'fertig') fertig = e;
        else beiEreignis?.(e);
      }
    }
  } catch (fehler) {
    if (signal?.aborted) throw new Abbruch('abgebrochen');
    if (fehler instanceof TypeError) {
      throw new Error('Die Verbindung ist mitten in der Antwort abgerissen.');
    }
    throw fehler;
  }
  if (!fertig) throw new Error('Die Verbindung ist mitten in der Antwort abgerissen.');
  return fertig;
}

/* Der sichtbare Text einer gespeicherten Antwort. Denkschritte und andere
 * Blöcke bleiben unsichtbar, gehen aber beim nächsten Mal unverändert mit. */
export function textAus(inhalt) {
  if (typeof inhalt === 'string') return inhalt;
  if (!Array.isArray(inhalt)) return '';
  return inhalt.filter((b) => b?.type === 'text').map((b) => b.text).join('');
}
