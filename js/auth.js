/*
 * Anmeldung über Supabase Auth, ohne Bibliothek: drei Aufrufe an die
 * Auth-Schnittstelle (anmelden, erneuern, abmelden).
 *
 * Die Sitzung liegt im localStorage. Das Zugangs-Token läuft nach etwa einer
 * Stunde ab; mit dem Erneuerungs-Token holt die App sich still ein neues.
 * Konten legt man im Supabase-Dashboard an, eine Registrierung gibt es in der
 * App nicht.
 */

import { KONFIG } from './config.js';

const SCHLUESSEL = 'fragmal.sitzung';

function lies() {
  try {
    return JSON.parse(localStorage.getItem(SCHLUESSEL) || 'null');
  } catch {
    return null;
  }
}

function schreibe(sitzung) {
  try {
    if (sitzung) localStorage.setItem(SCHLUESSEL, JSON.stringify(sitzung));
    else localStorage.removeItem(SCHLUESSEL);
  } catch {
    // Privater Modus ohne Speicher: dann gilt die Anmeldung nur bis zum Neuladen.
  }
  aktuelle = sitzung;
}

let aktuelle = lies();

export function sitzung() {
  return aktuelle;
}

function ausAntwort(daten) {
  return {
    zugang: daten.access_token,
    erneuern: daten.refresh_token,
    ablauf: Date.now() + (daten.expires_in ?? 3600) * 1000,
    nutzer: { id: daten.user?.id, email: daten.user?.email },
  };
}

async function tokenAnfrage(art, inhalt) {
  let antwort;
  try {
    antwort = await fetch(`${KONFIG.supabaseUrl}/auth/v1/token?grant_type=${art}`, {
      method: 'POST',
      headers: { apikey: KONFIG.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(inhalt),
    });
  } catch {
    const fehler = new Error('Keine Verbindung. Bist du online?');
    fehler.netz = true;
    throw fehler;
  }
  const daten = await antwort.json().catch(() => ({}));
  if (!antwort.ok) {
    const fehler = new Error(
      daten.error_code === 'invalid_credentials' || daten.error === 'invalid_grant'
        ? 'E-Mail oder Passwort stimmt nicht.'
        : daten.msg || daten.error_description || `Anmeldung fehlgeschlagen (${antwort.status}).`,
    );
    fehler.status = antwort.status;
    throw fehler;
  }
  return daten;
}

export async function anmelden(email, passwort) {
  const daten = await tokenAnfrage('password', { email, password: passwort });
  schreibe(ausAntwort(daten));
  return aktuelle;
}

let laufendeErneuerung = null;

/*
 * Ein gültiges Zugangs-Token, notfalls frisch erneuert. null heißt: Die
 * Sitzung ist vorbei, die App muss wieder zur Anmeldung.
 * Ohne Netz bleibt die Sitzung bestehen; dann scheitert eben die Frage.
 */
export async function gueltigesToken() {
  const s = aktuelle;
  if (!s) return null;
  if (s.ablauf - 60_000 > Date.now()) return s.zugang;
  if (!laufendeErneuerung) {
    laufendeErneuerung = tokenAnfrage('refresh_token', { refresh_token: s.erneuern })
      .then((daten) => {
        schreibe(ausAntwort(daten));
        return aktuelle.zugang;
      })
      .catch((fehler) => {
        if (fehler.netz) throw fehler;
        schreibe(null);
        return null;
      })
      .finally(() => {
        laufendeErneuerung = null;
      });
  }
  return laufendeErneuerung;
}

export async function abmelden() {
  const s = aktuelle;
  schreibe(null);
  if (!s) return;
  try {
    await fetch(`${KONFIG.supabaseUrl}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: KONFIG.publishableKey, Authorization: `Bearer ${s.zugang}` },
    });
  } catch {
    // Ohne Netz läuft das Token von selbst ab.
  }
}
