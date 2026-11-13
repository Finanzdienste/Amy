/*
 * Nimmt von anderen Apps am selben Anthropic-Zugang (Boxenstopp) entgegen, was
 * eine Anfrage an Claude ungefähr gekostet hat, und schreibt es in die Tabelle
 * fragmal_kosten. So kann „Frag mal“ anzeigen, wie viel vom monatlichen
 * API-Guthaben insgesamt schon weg ist.
 *
 * Wer melden darf: wer einen Anthropic-Schlüssel derselben Organisation hat.
 * Die App schickt ihren Schlüssel im Kopf x-anthropic-key mit; die Funktion
 * fragt Anthropic einmal (GET /v1/models), zu welcher Organisation er gehört,
 * und vergleicht das mit dem eigenen Schlüssel. Den Schlüssel speichert sie
 * nicht und schreibt ihn nirgends hin; sie merkt sich nur seinen Hash, solange
 * sie läuft, damit sie Anthropic nicht bei jeder Meldung fragen muss.
 */

export type Umgebung = {
  /** Der eigene Anthropic-Schlüssel (derselbe wie bei amy-chat). */
  anthropicKey?: string;
  /** Nur für die Tests: lenkt die Anfragen an eine simulierte API. */
  anthropicBaseUrl?: string;
  supabaseUrl: string;
  secretKey?: string;
  erlaubteUrspruenge: string[];
};

const KEIN_NUTZER = "00000000-0000-0000-0000-000000000000";

async function hash(text: string): Promise<string> {
  const daten = new TextEncoder().encode(text);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", daten));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function erstelleHandler(env: Umgebung) {
  const basis = env.anthropicBaseUrl ?? "https://api.anthropic.com";
  const geprueft = new Set<string>();
  let eigeneOrg: Promise<string> | null = null;

  async function orgVon(schluessel: string): Promise<string> {
    const antwort = await fetch(new URL("/v1/models?limit=1", basis), {
      headers: { "x-api-key": schluessel, "anthropic-version": "2026-10-21" },
    });
    await antwort.body?.cancel();
    if (!antwort.ok) return "";
    return antwort.headers.get("anthropic-organization-id") ?? "";
  }

  function cors(req: Request): Record<string, string> {
    const herkunft = req.headers.get("origin") ?? "";
    return {
      "Access-Control-Allow-Origin": env.erlaubteUrspruenge.includes(herkunft)
        ? herkunft
        : env.erlaubteUrspruenge[0] ?? "",
      "Access-Control-Allow-Headers": "content-type, x-anthropic-key",
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
    if (!env.anthropicKey || !env.secretKey) return antwort(503, "Nicht eingerichtet.");

    const schluessel = req.headers.get("x-anthropic-key") ?? "";
    if (!/^sk-ant-[\w-]{10,300}$/.test(schluessel)) return antwort(401, "Schlüssel fehlt.");

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

    const h = await hash(schluessel);
    if (!geprueft.has(h)) {
      eigeneOrg ??= orgVon(env.anthropicKey).then((o) => {
        if (!o) eigeneOrg = null;
        return o;
      });
      const [eigen, fremd] = await Promise.all([eigeneOrg, orgVon(schluessel)]);
      if (!fremd) return antwort(401, "Schlüssel abgelehnt.");
      if (!eigen || eigen !== fremd) {
        console.warn(`Meldung von ${app}: andere Organisation`);
        return antwort(403, "Andere Organisation.");
      }
      geprueft.add(h);
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
