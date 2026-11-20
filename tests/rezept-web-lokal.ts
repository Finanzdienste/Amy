/*
 * Startet die Funktion rezept-web lokal für die Tests. Das „Internet“ ist
 * die Attrappe: https://<website>/<pfad> geht an <attrappe>/netz/<website>/<pfad>
 * – geprüft wird trotzdem die echte Adresse. intern.example zeigt auf eine
 * private Adresse, alles andere auf eine öffentliche.
 */

import { erstelleHandler } from "../supabase/functions/rezept-web/handler.ts";

const netz = Deno.env.get("SUPABASE_URL") ?? "";

Deno.serve(
  {
    port: Number(Deno.env.get("PORT") ?? 0),
    hostname: "127.0.0.1",
    onListen: ({ port }) => console.log(`bereit ${port}`),
  },
  erstelleHandler({
    anthropicKey: Deno.env.get("ANTHROPIC_API_KEY") || undefined,
    erlaubteHashes: (Deno.env.get("ERLAUBTE_SCHLUESSEL") ?? "").split(",").filter(Boolean),
    erlaubteUrspruenge: (Deno.env.get("ERLAUBTE_URSPRUENGE") ?? "").split(",").filter(Boolean),
    holen: (url, init) => {
      const u = new URL(url);
      return fetch(`${netz}/netz/${u.hostname}${u.pathname}${u.search}`, init);
    },
    aufloesen: async (host) => (host === "intern.example" ? ["10.0.0.5"] : ["93.184.215.14"]),
    tavilyKey: Deno.env.get("TAVILY_API_KEY") || undefined,
    tavilyUrl: "https://api.tavily.com/search",
    maxSeite: 300_000,
    warten: 3000,
  }),
);
