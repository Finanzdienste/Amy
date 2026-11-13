/*
 * Der Server-Teil der App: nimmt ein Gespräch entgegen, fragt Claude und
 * schickt die Antwort Stück für Stück zurück.
 *
 * Warum es diesen Teil überhaupt gibt: Der API-Schlüssel darf nie in den
 * Browser. Die App liegt öffentlich auf GitHub Pages, und wer den Schlüssel
 * fände, könnte das Guthaben verbrauchen. Hier liegt er als Secret in
 * Supabase und verlässt den Server nicht.
 *
 * Wer fragen darf, entscheidet ERLAUBTE_NUTZER: eine Liste von Nutzer-IDs aus
 * Supabase Auth. Eine gültige Anmeldung allein reicht nicht, denn im selben
 * Supabase-Projekt könnten sich auch andere Konten anlegen.
 *
 * Die Funktion speichert keine Gespräche. Sie liegen nur auf dem Gerät, auf dem
 * sie geführt werden, und kommen bei jeder Frage vollständig mit. Aufgeschrieben
 * wird nur, was eine Antwort gekostet hat (für die Anzeige des Guthabens).
 */

import Anthropic from "npm:@anthropic-ai/sdk@1.7.0";
import { kostenUSD } from "./kosten.js";

export const MODELL = "claude-opus-5-5";
export const BERATER = "claude-fable-5-2";

/*
 * Die Beta-Funktionen:
 *
 *   server-side-fallback   Lehnt Opus eine Anfrage aus Sicherheitsgründen ab,
 *                          beantwortet ein anderes Modell sie im selben Aufruf,
 *                          statt dass die Antwort einfach leer bleibt.
 *
 *   thinking-binding       Claudes Denkschritte gelten nur im unveränderten
 *                          Gespräch. Sollte sich davor doch etwas geändert
 *                          haben, fallen die betroffenen Denkschritte still
 *                          weg, statt dass die ganze Anfrage scheitert.
 *
 *   advisor-tool           Opus kann bei schwierigen Fragen Fable 5.2 um Rat
 *                          fragen, so oft es das für nötig hält. Den Rat
 *                          liefert die API verschlüsselt; er geht wie alles
 *                          andere unverändert ins Gespräch zurück.
 */
export const BETAS = [
  "server-side-fallback-2026-07-01",
  "thinking-binding-controls-2026-08-01",
  "advisor-tool-2026-03-01",
];

/*
 * Das Werkzeug bleibt in jedem Gespräch Zeichen für Zeichen gleich: Eine
 * Änderung (anderes Modell, anderes caching) gilt als Änderung am Gespräch
 * und kostet die früheren Denkschritte. Keine Grenze für die Zahl der
 * Rückfragen, so gewünscht; gedeckelt ist das Ganze über das Guthaben.
 */
export const WERKZEUGE = [{
  type: "advisor_20260301",
  name: "advisor",
  model: BERATER,
  caching: { type: "ephemeral", ttl: "5m" },
}];

/* Wie oft eine pausierte Antwort (pause_turn) höchstens fortgesetzt wird. */
const MAX_FORTSETZUNGEN = 5;

/* Abstand des Herzschlags im Antwortstrom (Tests setzen ihn kürzer). */
export const HERZSCHLAG_MS = Number(globalThis.Deno?.env.get("HERZSCHLAG_MS")) || 10_000;

/* Obergrenze für eine Anfrage. Ein langes Gespräch mit viel Text liegt weit
 * darunter; das hier fängt nur Unsinn ab. */
const MAX_BYTES = 12 * 1024 * 1024;

export type Umgebung = {
  anthropicKey?: string;
  /** Geheimer Schlüssel des Supabase-Projekts, nur für die Tabelle fragmal_kosten. */
  secretKey?: string;
  /** Monatliches API-Guthaben in US-Dollar (Max: 100, Ultra: 200). */
  guthabenUsd?: number;
  /** Tag im Monat, an dem das Guthaben neu beginnt (1–28). */
  abrechnungTag?: number;
  /** Nur für die Tests: lenkt die Anfragen an eine simulierte API. */
  anthropicBaseUrl?: string;
  supabaseUrl: string;
  publishableKey: string;
  erlaubteNutzer: string[];
  erlaubteUrspruenge: string[];
};

export type Kontext = {
  ueberMich?: string;
  datum?: string;
  /** Beim Anlegen des Gesprächs gewählt; fehlt bei älteren Gesprächen. */
  modell?: string;
  aufwand?: string;
};

/*
 * Was in der App wählbar ist (Schlüssel = kontext.modell). Alles andere fällt
 * auf die Vorgabe zurück. Alle Paare sind gegen die echte API geprüft.
 *
 *   Opus 5.5 mit Berater    Opus schreibt, fragt bei Schwierigem Fable 5.2.
 *   Opus 5.5 allein         ohne Berater.
 *   Sonnet 5.5 mit Berater  halb so teuer wie Opus, fragt Fable 5.2.
 *   Haiku 5.5               sehr schnell und fast umsonst, ohne Berater.
 *   Fable 5.2               Fable schreibt selbst. Doppelt so teuer, und auf
 *                           hohem Aufwand oft minutenlang; ein Berater ist
 *                           hier sinnlos (Fable nimmt nur sich selbst).
 */
export const MODELLE: Record<string, { modell: string; berater: boolean }> = {
  [MODELL]: { modell: MODELL, berater: true },
  "claude-opus-5-5-allein": { modell: MODELL, berater: false },
  "claude-sonnet-5-5": { modell: "claude-sonnet-5-5", berater: true },
  "claude-haiku-5-5": { modell: "claude-haiku-5-5", berater: false },
  [BERATER]: { modell: BERATER, berater: false },
};
export const AUFWAENDE = ["low", "medium", "high", "xhigh", "max"];

export function einstellungenAus(kontext: Kontext) {
  const wahl = MODELLE[kontext.modell ?? ""] ?? MODELLE[MODELL];
  const aufwand = AUFWAENDE.includes(kontext.aufwand ?? "") ? kontext.aufwand! : "medium";
  return { modell: wahl.modell, aufwand, berater: wahl.berater };
}

/*
 * Der Systemtext. Er wird aus dem Kontext gebaut, den die App beim Anlegen
 * eines Gesprächs festhält, und bleibt deshalb während des ganzen Gesprächs
 * Zeichen für Zeichen gleich. Das ist wichtig: Ändert sich der Systemtext
 * mitten im Gespräch, verliert Claude seine früheren Denkschritte, und der
 * Zwischenspeicher bei Anthropic greift nicht mehr.
 *
 * Wer diesen Text ändert, ändert ihn auch für laufende Gespräche. Das geht,
 * kostet aber beim nächsten Mal in jedem dieser Gespräche den Zwischenspeicher.
 */
export function systemText(kontext: Kontext, { berater = true } = {}): string {
  const teile = [
    "Du sprichst mit jemandem über eine kleine private Chat-App. " +
      "Antworte in der Sprache, in der man dir schreibt, und so lang, " +
      "wie die Frage es verlangt: kurz bei kurzen Fragen, gründlich, " +
      "wenn jemand etwas Gründliches braucht.",
    "Die App zeigt Markdown an: Überschriften, Listen, Fett und Kursiv, " +
      "Links, Code und einfache Tabellen.",
    "In dieser App hast du keinen Zugang zum Internet. Wenn eine Frage " +
      "von Ereignissen nach deinem Wissensstand abhängen könnte, sag das.",
  ];
  if (berater) {
    teile.push(
      "Du hast einen Berater, das Werkzeug advisor, ein noch stärkeres " +
        "Modell. Frag ihn, wenn gründliches Nachdenken die Antwort spürbar " +
        "besser macht: knifflige Abwägungen und Entscheidungen, Rechnungen, " +
        "Pläne mit vielen Teilen, Fakten, bei denen du dir unsicher bist. " +
        "Für Plaudereien und einfache Fragen brauchst du ihn nicht.",
    );
  }
  if (kontext.datum) {
    teile.push(`Das Gespräch hat am ${kontext.datum} begonnen.`);
  }
  const ueberMich = (kontext.ueberMich ?? "").trim();
  if (ueberMich) {
    teile.push(
      "Das hat die Person in den Einstellungen über sich eingetragen:\n" +
        `<ueber_mich>\n${ueberMich}\n</ueber_mich>`,
    );
  }
  return teile.join("\n\n");
}

/*
 * Wie viel vom API-Guthaben „Frag mal“ schon verbraucht hat, für die Anzeige
 * in der App. Die Funktion schreibt nach jeder Antwort auf, was sie ungefähr
 * gekostet hat (Tabelle fragmal_kosten: Zeit, Nutzer-ID, Modell, Betrag, keine
 * Inhalte), und zählt das seit Beginn des Abrechnungsmonats zusammen. Andere
 * Apps am selben API-Zugang (Boxenstopp) melden ihre Kosten über die Funktion
 * api-kosten in dieselbe Tabelle; die Summe ist nach App aufgeteilt.
 */
export function abrechnungsBeginn(jetzt: Date, tag = 1): Date {
  const t = Math.min(Math.max(Math.trunc(tag) || 1, 1), 28);
  const j = jetzt.getUTCFullYear();
  const m = jetzt.getUTCMonth();
  return jetzt.getUTCDate() >= t
    ? new Date(Date.UTC(j, m, t))
    : new Date(Date.UTC(j, m - 1, t));
}

/* Der neue geheime Schlüssel (sb_secret_…) gehört nur in apikey; im Kopf
 * Authorization erwartet Supabase ein JWT. */
function datenbankKoepfe(env: Umgebung): Record<string, string> {
  return { apikey: env.secretKey!, "Content-Type": "application/json" };
}

async function kostenMerken(env: Umgebung, nutzer: string, modell: string, usd: number) {
  if (!env.secretKey || !(usd >= 0)) return;
  try {
    const antwort = await fetch(`${env.supabaseUrl}/rest/v1/fragmal_kosten`, {
      method: "POST",
      headers: { ...datenbankKoepfe(env), Prefer: "return=minimal" },
      body: JSON.stringify({ nutzer, modell, usd: Math.round(usd * 1e6) / 1e6 }),
    });
    if (!antwort.ok) console.error(`Kosten merken: HTTP ${antwort.status}`);
  } catch (fehler) {
    console.error(fehler);
  }
}

async function verbrauch(env: Umgebung): Promise<unknown> {
  if (!env.secretKey) return { verfuegbar: false };
  const seit = abrechnungsBeginn(new Date(), env.abrechnungTag);
  const antwort = await fetch(`${env.supabaseUrl}/rest/v1/rpc/fragmal_kosten_nach_app`, {
    method: "POST",
    headers: datenbankKoepfe(env),
    body: JSON.stringify({ seit: seit.toISOString() }),
  });
  if (!antwort.ok) {
    console.error(`Verbrauch lesen: HTTP ${antwort.status}`);
    return { verfuegbar: false };
  }
  const apps: Record<string, number> = {};
  for (const zeile of (await antwort.json()) ?? []) {
    apps[String(zeile.app)] = Number(zeile.usd) || 0;
  }
  const usd = Object.values(apps).reduce((s, x) => s + x, 0);
  const guthaben = env.guthabenUsd && env.guthabenUsd > 0 ? env.guthabenUsd : 100;
  return {
    verfuegbar: true,
    usd,
    apps,
    guthaben,
    prozent: Math.round((usd / guthaben) * 1000) / 10,
    seit: seit.toISOString().slice(0, 10),
  };
}

function corsKoepfe(req: Request, env: Umgebung): Record<string, string> {
  const herkunft = req.headers.get("origin") ?? "";
  const erlaubt = env.erlaubteUrspruenge.includes(herkunft)
    ? herkunft
    : env.erlaubteUrspruenge[0] ?? "";
  return {
    "Access-Control-Allow-Origin": erlaubt,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(
  status: number,
  daten: unknown,
  koepfe: Record<string, string>,
): Response {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { ...koepfe, "Content-Type": "application/json; charset=utf-8" },
  });
}

/* Fragt Supabase Auth, wem das Token gehört. Supabase selbst entscheidet, ob
 * es gültig ist; abgelaufene oder gefälschte Tokens kommen mit 401 zurück. */
async function nutzerZumToken(
  token: string,
  env: Umgebung,
): Promise<{ id: string } | null> {
  const antwort = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.publishableKey },
  });
  if (!antwort.ok) return null;
  const nutzer = await antwort.json();
  return typeof nutzer?.id === "string" ? { id: nutzer.id } : null;
}

type Nachricht = { role: "user" | "assistant"; content: unknown };

function pruefeNachrichten(wert: unknown): Nachricht[] | string {
  if (!Array.isArray(wert) || wert.length === 0) {
    return "Es fehlen die Nachrichten.";
  }
  for (const n of wert) {
    if (!n || (n.role !== "user" && n.role !== "assistant")) {
      return "Eine Nachricht hat keine gültige Rolle.";
    }
    if (typeof n.content !== "string" && !Array.isArray(n.content)) {
      return "Eine Nachricht hat keinen gültigen Inhalt.";
    }
  }
  if (wert[0].role !== "user" || wert[wert.length - 1].role !== "user") {
    return "Das Gespräch muss mit einer Frage beginnen und enden.";
  }
  return wert as Nachricht[];
}

export function erstelleHandler(env: Umgebung) {
  const client = env.anthropicKey
    ? new Anthropic({
      apiKey: env.anthropicKey,
      ...(env.anthropicBaseUrl ? { baseURL: env.anthropicBaseUrl } : {}),
    })
    : null;

  return async function handler(req: Request): Promise<Response> {
    const cors = corsKoepfe(req, env);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (req.method !== "POST") {
      return json(405, { fehler: "Nur POST." }, cors);
    }

    const token = (req.headers.get("authorization") ?? "")
      .match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) {
      return json(401, { fehler: "Bitte zuerst anmelden." }, cors);
    }
    const nutzer = await nutzerZumToken(token, env);
    if (!nutzer) {
      return json(401, {
        fehler: "Die Anmeldung ist abgelaufen. Bitte neu anmelden.",
      }, cors);
    }
    if (!env.erlaubteNutzer.includes(nutzer.id)) {
      console.warn(`Nicht freigeschaltet: ${nutzer.id}`);
      return json(403, {
        fehler: "Dieses Konto ist für die App nicht freigeschaltet.",
      }, cors);
    }

    const roh = await req.text();
    if (roh.length > MAX_BYTES) {
      return json(413, { fehler: "Das Gespräch ist zu lang." }, cors);
    }
    let eingabe: { art?: string; nachrichten?: unknown; kontext?: Kontext };
    try {
      eingabe = JSON.parse(roh);
    } catch {
      return json(400, { fehler: "Die Anfrage ist kein gültiges JSON." }, cors);
    }

    if (eingabe.art === "verbrauch") {
      try {
        return json(200, await verbrauch(env), cors);
      } catch (fehler) {
        console.error(fehler);
        return json(200, { verfuegbar: false }, cors);
      }
    }

    if (!client) {
      return json(500, {
        fehler:
          "Der API-Schlüssel fehlt noch. Er gehört als Secret ANTHROPIC_API_KEY in die Supabase-Funktion.",
      }, cors);
    }
    const nachrichten = pruefeNachrichten(eingabe.nachrichten);
    if (typeof nachrichten === "string") {
      return json(400, { fehler: nachrichten }, cors);
    }

    const wahl = einstellungenAus(eingabe.kontext ?? {});
    const system = [{ type: "text", text: systemText(eingabe.kontext ?? {}, wahl) }];
    const anfrage = (verlauf: unknown[]) =>
      client.beta.messages.stream({
        model: wahl.modell,
        max_tokens: 64000,
        // deno-lint-ignore no-explicit-any
        system: system as any,
        // deno-lint-ignore no-explicit-any
        messages: verlauf as any,
        // deno-lint-ignore no-explicit-any
        ...(wahl.berater ? { tools: WERKZEUGE as any } : {}),
        thinking: {
          type: "adaptive",
          block_binding: { prefix_mismatch_behavior: "drop_block" },
        },
        output_config: { effort: wahl.aufwand as "medium" },
        // Merkt sich den Gesprächsanfang bei Anthropic für ein paar Minuten.
        // Die nächste Frage im selben Gespräch kostet dann für den bekannten
        // Teil nur einen Bruchteil.
        cache_control: { type: "ephemeral" },
        betas: BETAS,
        fallbacks: "default",
      });

    let stream: ReturnType<typeof anfrage> | null = null;
    let abgebrochen = false;
    const kodierer = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Nach einem Abbruch ist der Strom zu; dann still nichts mehr senden.
        const sende = (ereignis: unknown) => {
          if (abgebrochen) return;
          controller.enqueue(
            kodierer.encode(`data: ${JSON.stringify(ereignis)}\n\n`),
          );
        };
        // Herzschlag: Während Claude lange nachdenkt oder den Berater fragt,
        // kommt oft lange nichts. Ein Kommentar alle paar Sekunden hält die
        // Verbindung offen, damit sie unterwegs niemand als tot abbaut.
        const herz = setInterval(() => {
          if (abgebrochen) return;
          try {
            controller.enqueue(kodierer.encode(": ping\n\n"));
          } catch {
            // Strom schon zu
          }
        }, HERZSCHLAG_MS);
        try {
          // Mit Werkzeugen auf dem Server kann eine Antwort pausieren
          // (pause_turn). Dann geht das bisher Geschriebene als Antwort mit,
          // und die API macht dort weiter. Die Teile werden am Ende zu einer
          // Antwort zusammengesetzt; aufeinanderfolgende Antworten fasst die
          // API ohnehin zu einer zusammen.
          const inhalt: unknown[] = [];
          const nutzungen: unknown[] = [];
          let nachricht;
          for (let runde = 0; ; runde++) {
            const verlauf = inhalt.length
              ? [...nachrichten, { role: "assistant", content: inhalt }]
              : nachrichten;
            stream = anfrage(verlauf);
            if (abgebrochen) stream.abort();
            for await (const ereignis of stream) {
              if (ereignis.type === "content_block_start") {
                const block = ereignis.content_block as { type: string; name?: string };
                if (block.type === "thinking") sende({ t: "denkt" });
                if (block.type === "server_tool_use" && block.name === "advisor") {
                  sende({ t: "berater" });
                }
              } else if (ereignis.type === "content_block_delta") {
                if (ereignis.delta.type === "text_delta") {
                  sende({ t: "text", d: ereignis.delta.text });
                }
              } else if ((ereignis as { type: string }).type === "ping" && !abgebrochen) {
                // Hält die Verbindung offen, während Claude nachdenkt.
                controller.enqueue(kodierer.encode(": ping\n\n"));
              }
            }
            nachricht = await stream.finalMessage();
            inhalt.push(...nachricht.content);
            nutzungen.push(nachricht.usage);
            if (nachricht.stop_reason !== "pause_turn" || runde >= MAX_FORTSETZUNGEN) break;
          }
          const nutzung = nutzungen.length === 1 ? nutzungen[0] : nutzungen;
          sende({
            t: "fertig",
            inhalt,
            stop: nachricht.stop_reason,
            modell: nachricht.model,
            nutzung,
          });
          await kostenMerken(env, nutzer.id, nachricht.model, kostenUSD(nutzung, nachricht.model));
        } catch (fehler) {
          if (!abgebrochen) console.error(fehler);
          sende({ t: "fehler", text: fehlerText(fehler) });
        } finally {
          clearInterval(herz);
          if (!abgebrochen) controller.close();
        }
      },
      cancel() {
        // Die App hat auf „Stopp“ gedrückt oder ist weg: Claude nicht weiter
        // schreiben lassen, das kostet sonst weiter.
        abgebrochen = true;
        stream?.abort();
      },
    });

    return new Response(body, {
      headers: {
        ...cors,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  };
}

export function fehlerText(fehler: unknown): string {
  if (fehler instanceof Anthropic.AuthenticationError) {
    return "Der API-Schlüssel wird nicht angenommen. Bitte in Supabase prüfen.";
  }
  if (fehler instanceof Anthropic.RateLimitError) {
    return "Gerade zu viele Anfragen. Bitte in einer Minute noch einmal.";
  }
  if (fehler instanceof Anthropic.BadRequestError) {
    const text = String(fehler.message ?? "");
    if (/credit balance/i.test(text)) {
      return "Das API-Guthaben ist für diesen Monat aufgebraucht.";
    }
    return `Die Anfrage wurde abgelehnt: ${text}`;
  }
  if (fehler instanceof Anthropic.InternalServerError) {
    return "Bei Anthropic hakt es gerade. Bitte gleich noch einmal versuchen.";
  }
  if (fehler instanceof Anthropic.APIError) {
    return `Fehler von der API (${fehler.status}): ${fehler.message}`;
  }
  if (fehler instanceof Anthropic.APIConnectionError) {
    return "Keine Verbindung zu Anthropic. Bitte gleich noch einmal versuchen.";
  }
  return "Unerwarteter Fehler auf dem Server.";
}
