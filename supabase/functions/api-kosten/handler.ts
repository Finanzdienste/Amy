/*
 * Nimmt von anderen Apps am selben Anthropic-Zugang (Boxenstopp) entgegen, was
 * eine Anfrage an Claude ungefähr gekostet hat, und schreibt es in die Tabelle
 * fragmal_kosten. So kann „Frag mal“ anzeigen, wie viel vom monatlichen
 * API-Guthaben insgesamt schon weg ist.
 *
 * Wer melden darf: wer einen erlaubten Anthropic-Schlüssel hat. Die App
 * schickt dafür nicht den Schlüssel, sondern nur seine Prüfsumme (SHA-256,
 * hex) im Kopf x-schluessel-hash – der Schlüssel selbst geht nur an
 * Anthropic. Erlaubt sind der eigene Schlüssel der Funktion (derselbe wie bei
 * amy-chat) und die Prüfsummen in ERLAUBTE_SCHLUESSEL (für andere Schlüssel
 * derselben Organisation, etwa den von Boxenstopp). Ein mitgeschickter
 * Schlüssel (x-anthropic-key, so meldeten ältere Fassungen) zählt nicht; die
 * Vorabfrage des Browsers erlaubt den Kopf nicht einmal mehr, dann schickt
 * ihn der Browser gar nicht erst.
 */

export type Umgebung = {
  /** Der eigene Anthropic-Schlüssel (derselbe wie bei amy-chat) – seine Prüfsumme ist erlaubt. */
  anthropicKey?: string;
  /** Weitere erlaubte Schlüssel als Prüfsumme (SHA-256, hex). */
  erlaubteHashes?: string[];
  supabaseUrl: string;
  secretKey?: string;
  erlaubteUrspruenge: string[];
};

const KEIN_NUTZER = "00000000-0000-0000-0000-000000000000";
const PRUEFSUMME = /^[0-9a-f]{64}$/;

export async function hash(text: string): Promise<string> {
  const daten = new TextEncoder().encode(text);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", daten));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function erstelleHandler(env: Umgebung) {
  let erlaubt: Promise<Set<string>> | null = null;
  const erlaubteSumme = () => {
    erlaubt ??= (async () => {
      const summen = new Set((env.erlaubteHashes ?? []).map((h) => h.trim().toLowerCase()).filter((h) => PRUEFSUMME.test(h)));
      if (env.anthropicKey) summen.add(await hash(env.anthropicKey));
      return summen;
    })();
    return erlaubt;
  };

  function cors(req: Request): Record<string, string> {
    const herkunft = req.headers.get("origin") ?? "";
    return {
      "Access-Control-Allow-Origin": env.erlaubteUrspruenge.includes(herkunft)
        ? herkunft
        : env.erlaubteUrspruenge[0] ?? "",
      "Access-Control-Allow-Headers": "content-type, x-schluessel-hash",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
  }

  return async function handler(req: Request): Promise<Response> {
    const koepfe = cors(req);
    const antwort = (status: number, text = "") =>
      new Response(text || null, { status, headers: koepfe });

    if (req.method === "OPTIONS") return antwort(204);
    if (req.method !== "POST") return antwort(405, "Nur POST.");
    if (!env.secretKey) return antwort(503, "Nicht eingerichtet.");

    const summe = (req.headers.get("x-schluessel-hash") ?? "").trim().toLowerCase();
    if (!PRUEFSUMME.test(summe)) return antwort(401, "Prüfsumme fehlt.");

    let eingabe: { app?: unknown; modell?: unknown; usd?: unknown };
    try {
      eingabe = await req.json();
    } catch {
      return antwort(400, "Kein JSON.");
    }
    const app = String(eingabe.app ?? "");
    const modell = String(eingabe.modell ?? "").slice(0, 60);
    const usd = Number(eingabe.usd);
    if (!/^[a-z0-9-]{1,30}$/.test(app) || app === "fragmal") return antwort(400, "App?");
    if (!modell || !(usd > 0 && usd <= 50)) return antwort(400, "Betrag?");

    if (!(await erlaubteSumme()).has(summe)) {
      console.warn(`Meldung von ${app}: Schlüssel nicht erlaubt`);
      return antwort(403, "Schlüssel nicht erlaubt.");
    }

    const eintrag = await fetch(`${env.supabaseUrl}/rest/v1/fragmal_kosten`, {
      method: "POST",
      headers: { apikey: env.secretKey, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ app, nutzer: KEIN_NUTZER, modell, usd: Math.round(usd * 1e6) / 1e6 }),
    });
    if (!eintrag.ok) {
      console.error(`Kosten von ${app}: HTTP ${eintrag.status}`);
      return antwort(502);
    }
    return antwort(204);
  };
}
