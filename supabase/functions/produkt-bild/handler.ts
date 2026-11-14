/*
 * Linkvorschau für Boxenstopp: das Hauptbild einer Produktseite.
 *
 * Findet Claude zu einem Strichcode eine Shopseite, bekommt Boxenstopp von
 * dort Name, Marke und Angaben – aber kein Bild: Der Browser darf fremde
 * Seiten nicht lesen (CORS), und Claude bekommt Seiten nur als Text. Diese
 * Funktion holt die Seite wie eine Linkvorschau in einem Messenger, liest
 * das Hauptbild aus ihren Angaben (og:image, twitter:image, das Bild im
 * Produkt-JSON-LD, link rel="image_src") und schickt es zurück.
 *
 * Wer fragen darf: wie bei api-kosten – wer die Prüfsumme (SHA-256, hex,
 * Kopf x-schluessel-hash) eines erlaubten Anthropic-Schlüssels schickt (der
 * eigene der Funktion oder einer aus ERLAUBTE_SCHLUESSEL). Den Schlüssel
 * selbst bekommt die Funktion nicht.
 *
 * Was sie holt: nur https, nur Namen (keine IP-Adressen, nichts Internes; was
 * auf eine private Adresse zeigt, nicht), höchstens drei Weiterleitungen, je
 * neu geprüft; die Seite bis 1,5 MB (das Bild steht oben), das Bild bis 8 MB
 * und nur als JPEG, PNG, WebP, GIF oder AVIF (lieber WebP oder JPEG – die
 * kann jedes Handy lesen). Sie nennt sich ehrlich
 * (KENNUNG) und versucht es nicht mit anderen Köpfen, wenn eine Seite sie
 * abweist. Rossmann nicht (GESPERRT). Gespeichert wird nichts; ins Protokoll
 * kommt bei Fehlern nur die Website und der Status.
 */

export type Umgebung = {
  /** Der eigene Anthropic-Schlüssel (derselbe wie bei amy-chat) – seine Prüfsumme ist erlaubt. */
  anthropicKey?: string;
  /** Weitere erlaubte Schlüssel als Prüfsumme (SHA-256, hex). */
  erlaubteHashes?: string[];
  erlaubteUrspruenge: string[];
  /** fetch – die Tests geben ein eigenes. */
  holen?: (url: string, init: RequestInit) => Promise<Response>;
  /** Die IP-Adressen eines Namens ([] wenn unbekannt) – die Tests geben eine eigene. */
  aufloesen?: (host: string) => Promise<string[]>;
  maxSeite?: number;
  maxBild?: number;
  warten?: number;
};

export const KENNUNG = "Boxenstopp-Linkvorschau (+https://github.com/Finanzdienste/Boxenstopp)";
/** Liest die Funktion nicht (Regel in Boxenstopp: kein Rossmann). */
export const GESPERRT = ["rossmann.de"];
const PRUEFSUMME = /^[0-9a-f]{64}$/;
const BILDTYP = /^image\/(?:jpeg|png|webp|gif|avif)$/;
const SEITENTYP = /^(?:text\/html|application\/xhtml\+xml)\b/;
const WEITERLEITUNGEN = 3;

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

function attribut(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"));
  return m ? zeichen((m[1] ?? m[2] ?? m[3] ?? "").trim()) : "";
}

const META = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src", "image"];

/** Bilder aus dem JSON-LD (Product, auch in @graph): image als Text, Liste oder { url }. */
function ausJsonLd(html: string): string[] {
  const bilder: string[] = [];
  const nimm = (b: unknown) => {
    for (const x of Array.isArray(b) ? b : [b]) {
      if (typeof x === "string") bilder.push(x);
      else if (x && typeof x === "object" && typeof (x as { url?: unknown }).url === "string") bilder.push((x as { url: string }).url);
    }
  };
  const gehe = (o: unknown, tiefe = 0) => {
    if (!o || typeof o !== "object" || tiefe > 6) return;
    if (Array.isArray(o)) { for (const x of o) gehe(x, tiefe + 1); return; }
    const d = o as Record<string, unknown>;
    const typ = ([] as unknown[]).concat(d["@type"] ?? []).map(String);
    if (typ.some((t) => /product/i.test(t)) && d.image) nimm(d.image);
    if (d["@graph"]) gehe(d["@graph"], tiefe + 1);
    if (d.mainEntity) gehe(d.mainEntity, tiefe + 1);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { gehe(JSON.parse(m[1].trim())); } catch { /* kaputtes JSON-LD: weiter */ }
  }
  return bilder;
}

/** Die Bilder einer Seite, das wichtigste zuerst, als volle Adressen (ohne Doppelte). */
export function bilderAus(html: string, seite: URL): string[] {
  const funde: string[] = [];
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const name of META) {
    for (const tag of metas) {
      const k = (attribut(tag, "property") || attribut(tag, "name") || attribut(tag, "itemprop")).toLowerCase();
      if (k === name) { const v = attribut(tag, "content"); if (v) funde.push(v); }
    }
  }
  funde.push(...ausJsonLd(html));
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (/^image_src$/i.test(attribut(tag, "rel"))) { const v = attribut(tag, "href"); if (v) funde.push(v); }
  }
  const voll: string[] = [];
  for (const f of funde) {
    try {
      const u = new URL(f, seite);
      if (u.protocol === "https:" && !voll.includes(u.href)) voll.push(u.href);
    } catch { /* keine Adresse */ }
  }
  return voll;
}

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

export function erstelleHandler(env: Umgebung) {
  const holen = env.holen ?? ((url: string, init: RequestInit) => fetch(url, init));
  const aufloesen = env.aufloesen ?? (async () => [] as string[]);
  const maxSeite = env.maxSeite ?? 1_500_000;
  const maxBild = env.maxBild ?? 8_000_000;
  const warten = env.warten ?? 8000;

  let erlaubt: Promise<Set<string>> | null = null;
  const erlaubteSumme = () => {
    erlaubt ??= (async () => {
      const summen = new Set((env.erlaubteHashes ?? []).map((h) => h.trim().toLowerCase()).filter((h) => PRUEFSUMME.test(h)));
      if (env.anthropicKey) summen.add(await hash(env.anthropicKey));
      return summen;
    })();
    return erlaubt;
  };

  /** Holen mit Weiterleitungen von Hand – jede Adresse wird geprüft, auch der Name dahinter. */
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

    if (req.method === "OPTIONS") return antwort(204);
    if (req.method !== "POST") return antwort(405, "Nur POST.");

    const summe = (req.headers.get("x-schluessel-hash") ?? "").trim().toLowerCase();
    if (!PRUEFSUMME.test(summe)) return antwort(401, "Prüfsumme fehlt.");
    if (!(await erlaubteSumme()).has(summe)) return antwort(403, "Schlüssel nicht erlaubt.");

    let seite: URL;
    try {
      const eingabe = await req.json() as { seite?: unknown };
      const roh = String(eingabe?.seite ?? "");
      if (!roh || roh.length > 800) throw new Error("zu lang");
      seite = new URL(roh);
    } catch {
      return antwort(400, "Adresse?");
    }
    const website = seite.hostname;

    try {
      const { res: s, url: bei } = await abrufen(seite, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5");
      if (!s.ok) {
        await s.body?.cancel();
        console.warn(`produkt-bild: ${website} – Seite ${s.status}`);
        return antwort(502, "Die Seite hat abgelehnt.");
      }
      if (!SEITENTYP.test(s.headers.get("content-type") ?? "")) {
        await s.body?.cancel();
        return antwort(404, "Keine Seite mit Bild.");
      }
      const html = new TextDecoder().decode(await lesen(s, maxSeite, true) ?? new Uint8Array());
      for (const adresse of bilderAus(html, bei).slice(0, 4)) {
        let b: Response;
        try {
          ({ res: b } = await abrufen(new URL(adresse), "image/webp,image/jpeg,image/png,image/avif;q=0.8,image/*;q=0.5"));
        } catch (e) {
          if (e instanceof Abgelehnt) continue;
          throw e;
        }
        const typ = (b.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (!b.ok || !BILDTYP.test(typ)) { await b.body?.cancel(); continue; }
        const daten = await lesen(b, maxBild, false);
        if (!daten || !daten.length) continue;
        return new Response(daten, { status: 200, headers: { ...koepfe, "Content-Type": typ, "Cache-Control": "private, max-age=0" } });
      }
      return antwort(404, "Kein Bild gefunden.");
    } catch (e) {
      if (e instanceof Abgelehnt) {
        if (e.status !== 422) console.warn(`produkt-bild: ${website} – ${e.message}`);
        return antwort(e.status, e.message);
      }
      console.error(`produkt-bild: ${website} – ${e instanceof Error ? e.name : "Fehler"}`);
      return antwort(502, "Ging nicht.");
    }
  };
}
