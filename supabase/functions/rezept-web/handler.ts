/*
 * Rezepte aus dem Netz für Boxenstopp – ohne Claude (Tobi, 20.11.2026: „mach
 * so viel wie möglich selbst“). Zwei Dinge, beide POST mit JSON:
 *
 *   { art: "seite", seite }   Eine Rezeptseite holen (Amy fügt einen Link ein):
 *       → { url, titel, rezept | null, text }. rezept steht in den Angaben der
 *       Seite (JSON-LD „Recipe“, das haben Chefkoch, Lecker, die meisten Blogs):
 *       { name, zutaten[], schritte[], portionen, minuten, bild }. text ist der
 *       sichtbare Text (für die KI, wenn es kein rezept gibt), höchstens 15 000
 *       Zeichen. Erst robots.txt: Verbietet sie die Seite, wird nichts geholt.
 *   { art: "suche", q, max, seiten }   Im Internet suchen – mit Tavily (Secret
 *       TAVILY_API_KEY; Tavily hat es für diese private App erlaubt):
 *       → { ergebnisse: [{ titel, url, text }] }, max 1–8, mit seiten auch der
 *       Text der Seiten (gekürzt). Die Suchanfrage kommt nicht ins Protokoll.
 *
 * Wer fragen darf: wie bei produkt-bild – die Prüfsumme (SHA-256, hex, Kopf
 * x-schluessel-hash) eines erlaubten Schlüssels (der Anthropic-Schlüssel der
 * Funktion oder einer aus ERLAUBTE_SCHLUESSEL, auch ein Gemini-Schlüssel).
 *
 * Was sie holt: nur https, keine IP-Adressen und nichts Internes, höchstens
 * drei Weiterleitungen, je neu geprüft, die Seite bis 2 MB; ehrliche Kennung
 * (KENNUNG), keine anderen Köpfe, wenn eine Seite abweist. Rossmann nicht.
 * Gespeichert wird nichts.
 */

export type Umgebung = {
  anthropicKey?: string;
  erlaubteHashes?: string[];
  erlaubteUrspruenge: string[];
  /** Der Schlüssel für Tavily – ohne ihn keine Suche. */
  tavilyKey?: string;
  tavilyUrl?: string;
  holen?: (url: string, init: RequestInit) => Promise<Response>;
  aufloesen?: (host: string) => Promise<string[]>;
  maxSeite?: number;
  warten?: number;
};

export const KENNUNG = "Boxenstopp-Rezeptleser (+https://github.com/Finanzdienste/Boxenstopp)";
/** Das Wort, mit dem sich die Funktion in robots.txt angesprochen fühlt. */
export const ROBOT = "boxenstopp";
export const GESPERRT = ["rossmann.de"];
const PRUEFSUMME = /^[0-9a-f]{64}$/;
const SEITENTYP = /^(?:text\/html|application\/xhtml\+xml)\b/;
const WEITERLEITUNGEN = 3;
export const MAX_TEXT = 15_000;
const MAX_SUCHE = 300;

export async function hash(text: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

class Abgelehnt extends Error {
  constructor(public status: number, meldung: string) {
    super(meldung);
  }
}

/** Eine private, lokale oder sonst nicht öffentliche IPv4-Adresse? Was keine ist, zählt auch so. */
function privat4(ip: string): boolean {
  const t = ip.split(".").map((x) => (/^\d{1,3}$/.test(x) ? Number(x) : NaN));
  if (t.length !== 4 || t.some((x) => !(x >= 0 && x <= 255))) return true;
  const [a, b] = t;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19));
}

export function privat(ip: string): boolean {
  const x = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (!x.includes(":")) return privat4(x);
  if (x === "::" || x === "::1") return true;
  const v4 = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return privat4(v4[1]);
  return /^(?:fc|fd|fe[89ab])/.test(x);
}

/** Darf die Funktion diese Adresse holen? Sonst warum nicht. */
export function adresseOk(u: URL): string {
  if (u.protocol !== "https:") return "nur https";
  if (u.username || u.password) return "keine Anmeldung in der Adresse";
  if (u.port && u.port !== "443") return "kein anderer Port";
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  if (/^\d+(?:\.\d+){3}$/.test(h) || h.includes(":")) return "keine IP-Adressen";
  if (!h.includes(".") || /(?:^|\.)(?:localhost|local|internal|intranet|lan|home|corp|arpa)$/.test(h)) return "nichts Internes";
  if (GESPERRT.some((g) => h === g || h.endsWith(`.${g}`))) return "diese Seite liest die App nicht";
  return "";
}


/** HTML-Zeichen in Attributen („&amp;“ …) zurück. */
const zeichen = (s: string) =>
  s.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'").replace(/&#x2f;|&#0*47;/gi, "/")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");


/** Den Inhalt lesen – höchstens max Bytes; abschneiden: dann nur so viel, sonst null, wenn es mehr ist. */
async function lesen(res: Response, max: number, abschneiden: boolean): Promise<Uint8Array | null> {
  const angesagt = Number(res.headers.get("content-length") || 0);
  if (!abschneiden && angesagt > max) { await res.body?.cancel(); return null; }
  const leser = res.body?.getReader();
  if (!leser) return new Uint8Array();
  const teile: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await leser.cancel();
      if (!abschneiden) return null;
      teile.push(value.subarray(0, value.length - (n - max)));
      n = max;
      break;
    }
    teile.push(value);
  }
  const alles = new Uint8Array(n);
  let i = 0;
  for (const t of teile) { alles.set(t, i); i += t.length; }
  return alles;
}


/** Alle HTML-Zeichen, auch Zahlen („&#8211;“). */
export function entschluesseln(s: string): string {
  return zeichen(s.replace(/&nbsp;/gi, " ").replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return " "; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return " "; } }))
    .replace(/&auml;/g, "ä").replace(/&ouml;/g, "ö").replace(/&uuml;/g, "ü").replace(/&Auml;/g, "Ä").replace(/&Ouml;/g, "Ö").replace(/&Uuml;/g, "Ü").replace(/&szlig;/g, "ß");
}

/** Text ohne Tags, ohne doppelte Leerzeichen. */
const sauber = (s: unknown, max = 600) => (typeof s === "string" || typeof s === "number")
  ? entschluesseln(String(s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").replace(/\s+([.,;:!?)])/g, "$1").trim().slice(0, max)
  : "";

/** „PT1H30M“ → 90. */
export function minuten(iso: unknown): number {
  const m = String(iso ?? "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return 0;
  const n = (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0);
  return n > 0 && n < 7 * 24 * 60 ? n : 0;
}

export type Rezept = { name: string; zutaten: string[]; schritte: string[]; portionen: number; minuten: number; bild: string };

/** Die Schritte: Text, Liste, HowToStep { text }, HowToSection { itemListElement }. */
function schritteAus(x: unknown, aus: string[] = [], tiefe = 0): string[] {
  if (tiefe > 5 || aus.length >= 60) return aus;
  if (typeof x === "string") {
    for (const t of x.split(/\n+|(?<=\.)\s+(?=\d+\.\s)/)) { const s = sauber(t); if (s) aus.push(s); }
  } else if (Array.isArray(x)) {
    for (const y of x) schritteAus(y, aus, tiefe + 1);
  } else if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (o.itemListElement) schritteAus(o.itemListElement, aus, tiefe + 1);
    else { const s = sauber(o.text ?? o.name); if (s) aus.push(s); }
  }
  return aus;
}

const bildAus = (b: unknown): string => {
  const x = Array.isArray(b) ? b[0] : b;
  if (typeof x === "string") return x;
  if (x && typeof x === "object" && typeof (x as { url?: unknown }).url === "string") return (x as { url: string }).url;
  return "";
};

/** Das Rezept aus dem JSON-LD einer Seite (auch in @graph oder mainEntity) – oder null. */
export function rezeptAus(html: string, seite: URL): Rezept | null {
  let fund: Record<string, unknown> | null = null;
  const gehe = (o: unknown, tiefe = 0) => {
    if (fund || !o || typeof o !== "object" || tiefe > 6) return;
    if (Array.isArray(o)) { for (const x of o) gehe(x, tiefe + 1); return; }
    const d = o as Record<string, unknown>;
    const typ = ([] as unknown[]).concat(d["@type"] ?? []).map(String);
    if (typ.some((t) => /^(?:https?:\/\/schema\.org\/)?Recipe$/i.test(t))) { fund = d; return; }
    if (d["@graph"]) gehe(d["@graph"], tiefe + 1);
    if (d.mainEntity) gehe(d.mainEntity, tiefe + 1);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { gehe(JSON.parse(m[1].trim())); } catch { /* kaputtes JSON-LD: weiter */ }
    if (fund) break;
  }
  if (!fund) return null;
  const r = fund as Record<string, unknown>;
  const zutaten = ([] as unknown[]).concat(r.recipeIngredient ?? r.ingredients ?? []).map((z) => sauber(z, 160)).filter(Boolean).slice(0, 60);
  const schritte = schritteAus(r.recipeInstructions).slice(0, 60);
  const name = sauber(r.name, 120);
  if (!name || (!zutaten.length && !schritte.length)) return null;
  const ertrag = ([] as unknown[]).concat(r.recipeYield ?? []).map((y) => Number(String(y).match(/\d+/)?.[0] ?? 0)).find((n) => n > 0 && n <= 50) ?? 0;
  let bild = "";
  try { const b = bildAus(r.image); if (b) bild = new URL(b, seite).href; } catch { /* keins */ }
  if (bild && !bild.startsWith("https:")) bild = "";
  return { name, zutaten, schritte, portionen: ertrag, minuten: minuten(r.totalTime) || minuten(r.cookTime) + minuten(r.prepTime), bild };
}

/** Der sichtbare Text einer Seite – ohne Skripte, Stile, Navigation. */
export function textAus(html: string): string {
  const rumpf = html.replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(?:br|\/p|\/li|\/h\d|\/div|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return entschluesseln(rumpf).replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
}

export const titelAus = (html: string) => sauber(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "", 200);

/**
 * Darf ein Robot mit dem Namen ROBOT diesen Pfad lesen? Die Gruppe für ihn
 * gilt, sonst die für „*“; die längste passende Regel gewinnt, Allow vor
 * Disallow bei gleicher Länge. * und $ wie bei Google.
 */
export function robotsErlaubt(txt: string, pfad: string): boolean {
  const gruppen: { agenten: string[]; regeln: { erlaubt: boolean; muster: string }[] }[] = [];
  let aktuell: (typeof gruppen)[number] | null = null;
  let regelnGesehen = false;
  for (const roh of txt.split(/\r?\n/)) {
    const zeile = roh.replace(/#.*$/, "").trim();
    const m = zeile.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const feld = m[1].toLowerCase();
    const wert = m[2].trim();
    if (feld === "user-agent") {
      if (!aktuell || regelnGesehen) { aktuell = { agenten: [], regeln: [] }; gruppen.push(aktuell); regelnGesehen = false; }
      aktuell.agenten.push(wert.toLowerCase());
    } else if ((feld === "allow" || feld === "disallow") && aktuell) {
      regelnGesehen = true;
      if (feld === "disallow" && !wert) continue;
      aktuell.regeln.push({ erlaubt: feld === "allow", muster: wert });
    }
  }
  const fuerUns = gruppen.filter((g) => g.agenten.some((a) => a !== "*" && ROBOT.includes(a.replace(/[^a-z0-9]/g, "")) && a.length >= 3));
  const gruppe = fuerUns.length ? fuerUns : gruppen.filter((g) => g.agenten.includes("*"));
  const regeln = gruppe.flatMap((g) => g.regeln);
  let best: { erlaubt: boolean; laenge: number } | null = null;
  for (const r of regeln) {
    const re = new RegExp(`^${r.muster.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$|\$$/, "$")}`);
    if (!re.test(pfad)) continue;
    if (!best || r.muster.length > best.laenge || (r.muster.length === best.laenge && r.erlaubt)) best = { erlaubt: r.erlaubt, laenge: r.muster.length };
  }
  return best ? best.erlaubt : true;
}

export function erstelleHandler(env: Umgebung) {
  const holen = env.holen ?? ((url: string, init: RequestInit) => fetch(url, init));
  const aufloesen = env.aufloesen ?? (async () => [] as string[]);
  const maxSeite = env.maxSeite ?? 2_000_000;
  const warten = env.warten ?? 9000;
  const tavilyUrl = env.tavilyUrl ?? "https://api.tavily.com/search";

  let erlaubt: Promise<Set<string>> | null = null;
  const erlaubteSumme = () => {
    erlaubt ??= (async () => {
      const summen = new Set((env.erlaubteHashes ?? []).map((h) => h.trim().toLowerCase()).filter((h) => PRUEFSUMME.test(h)));
      if (env.anthropicKey) summen.add(await hash(env.anthropicKey));
      return summen;
    })();
    return erlaubt;
  };

  async function abrufen(start: URL, accept: string): Promise<{ res: Response; url: URL }> {
    let url = start;
    for (let i = 0; i <= WEITERLEITUNGEN; i++) {
      const fehler = adresseOk(url);
      if (fehler) throw new Abgelehnt(422, fehler);
      const ips = await aufloesen(url.hostname).catch(() => [] as string[]);
      if (ips.some(privat)) throw new Abgelehnt(422, "nichts Internes");
      let res: Response;
      try {
        res = await holen(url.href, {
          redirect: "manual",
          headers: { "User-Agent": KENNUNG, Accept: accept, "Accept-Language": "de-DE,de;q=0.9,en;q=0.5" },
          signal: AbortSignal.timeout(warten),
        });
      } catch {
        throw new Abgelehnt(502, "nicht erreichbar");
      }
      const ziel = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!ziel) return { res, url };
      await res.body?.cancel();
      try { url = new URL(ziel, url); } catch { throw new Abgelehnt(502, "kaputte Weiterleitung"); }
    }
    throw new Abgelehnt(502, "zu viele Weiterleitungen");
  }

  /** robots.txt der Website: Fehlt sie (4xx), ist alles erlaubt; geht sie gar nicht (5xx, kein Netz), lieber nicht. */
  async function robotsOk(u: URL): Promise<boolean> {
    let r: Response;
    try {
      ({ res: r } = await abrufen(new URL("/robots.txt", u), "text/plain,*/*;q=0.5"));
    } catch (e) {
      if (e instanceof Abgelehnt && e.status === 422) throw e;
      return false;
    }
    if (r.status >= 400 && r.status < 500) { await r.body?.cancel(); return true; }
    if (!r.ok) { await r.body?.cancel(); return false; }
    const txt = new TextDecoder().decode(await lesen(r, 500_000, true) ?? new Uint8Array());
    return robotsErlaubt(txt, `${u.pathname}${u.search}`);
  }

  function cors(req: Request): Record<string, string> {
    const herkunft = req.headers.get("origin") ?? "";
    return {
      "Access-Control-Allow-Origin": env.erlaubteUrspruenge.includes(herkunft) ? herkunft : env.erlaubteUrspruenge[0] ?? "",
      "Access-Control-Allow-Headers": "content-type, x-schluessel-hash",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
  }

  return async function handler(req: Request): Promise<Response> {
    const koepfe = cors(req);
    const antwort = (status: number, text = "") => new Response(text || null, { status, headers: koepfe });
    const json = (daten: unknown) => new Response(JSON.stringify(daten), { status: 200, headers: { ...koepfe, "Content-Type": "application/json; charset=utf-8" } });

    if (req.method === "OPTIONS") return antwort(204);
    if (req.method !== "POST") return antwort(405, "Nur POST.");
    const summe = (req.headers.get("x-schluessel-hash") ?? "").trim().toLowerCase();
    if (!PRUEFSUMME.test(summe)) return antwort(401, "Prüfsumme fehlt.");
    if (!(await erlaubteSumme()).has(summe)) return antwort(403, "Schlüssel nicht erlaubt.");

    let eingabe: Record<string, unknown>;
    try { eingabe = await req.json(); } catch { return antwort(400, "JSON?"); }
    if (!eingabe || typeof eingabe !== "object") return antwort(400, "JSON?");

    if (eingabe.art === "suche") {
      const q = sauber(eingabe.q, MAX_SUCHE);
      if (!q) return antwort(400, "Wonach suchen?");
      if (!env.tavilyKey) return antwort(503, "Die Suche ist nicht eingerichtet.");
      const max = Math.min(8, Math.max(1, Number(eingabe.max) || 5));
      const seiten = eingabe.seiten === true;
      let r: Response;
      try {
        r = await holen(tavilyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.tavilyKey}` },
          body: JSON.stringify({ query: q, max_results: max, search_depth: "basic", include_answer: false, include_raw_content: seiten ? "text" : false, include_images: false }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        return antwort(502, "Die Suche ist gerade nicht erreichbar.");
      }
      if (r.status === 432 || r.status === 433 || r.status === 429) { await r.body?.cancel(); return antwort(429, "Das Gratis-Kontingent der Suche ist für diesen Monat aufgebraucht."); }
      if (!r.ok) { await r.body?.cancel(); console.warn(`rezept-web: Suche ${r.status}`); return antwort(502, "Die Suche hat abgelehnt."); }
      let d: { results?: { title?: string; url?: string; content?: string; raw_content?: string }[] } = {};
      try { d = await r.json(); } catch { return antwort(502, "Die Suche hat Unsinn geantwortet."); }
      const ergebnisse = (Array.isArray(d.results) ? d.results : []).slice(0, max).flatMap((x) => {
        let url = "";
        try { const u = new URL(String(x.url ?? "")); if (u.protocol === "https:" || u.protocol === "http:") url = u.href; } catch { /* keine */ }
        if (!url) return [];
        const text = [sauber(x.content, 1200), seiten ? String(x.raw_content ?? "").replace(/\s+/g, " ").trim().slice(0, 4000) : ""].filter(Boolean).join("\n");
        return [{ titel: sauber(x.title, 200), url, text }];
      });
      return json({ ergebnisse });
    }

    if (eingabe.art !== "seite") return antwort(400, "art: seite oder suche");
    let seite: URL;
    try {
      const roh = String(eingabe.seite ?? "");
      if (!roh || roh.length > 1200) throw new Error("zu lang");
      seite = new URL(roh);
    } catch {
      return antwort(400, "Adresse?");
    }
    const website = seite.hostname;
    try {
      const fehler = adresseOk(seite);
      if (fehler) return antwort(422, fehler);
      if (!(await robotsOk(seite))) return antwort(451, "Diese Seite möchte nicht von Programmen gelesen werden (robots.txt).");
      const { res: s, url: bei } = await abrufen(seite, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5");
      if (!s.ok) {
        await s.body?.cancel();
        console.warn(`rezept-web: ${website} – Seite ${s.status}`);
        return antwort(502, "Die Seite hat abgelehnt.");
      }
      if (!SEITENTYP.test(s.headers.get("content-type") ?? "")) { await s.body?.cancel(); return antwort(415, "Das ist keine Webseite."); }
      const html = new TextDecoder().decode(await lesen(s, maxSeite, true) ?? new Uint8Array());
      return json({ url: bei.href, titel: titelAus(html), rezept: rezeptAus(html, bei), text: textAus(html) });
    } catch (e) {
      if (e instanceof Abgelehnt) {
        if (e.status !== 422) console.warn(`rezept-web: ${website} – ${e.message}`);
        return antwort(e.status, e.message);
      }
      console.error(`rezept-web: ${website} – ${e instanceof Error ? e.name : "Fehler"}`);
      return antwort(502, "Ging nicht.");
    }
  };
}
