/*
 * Einstieg der Supabase-Funktion „rezept-web“ (siehe handler.ts). Secrets:
 * ANTHROPIC_API_KEY (seine Prüfsumme darf fragen), ERLAUBTE_SCHLUESSEL,
 * ERLAUBTE_URSPRUENGE wie bei produkt-bild – und TAVILY_API_KEY für die Suche
 * (legt Tobi selbst an; ohne ihn geht nur das Lesen einer Seite).
 */

import { erstelleHandler } from "./handler.ts";

async function aufloesen(host: string): Promise<string[]> {
  const v4 = await Deno.resolveDns(host, "A").catch(() => [] as string[]);
  const v6 = await Deno.resolveDns(host, "AAAA").catch(() => [] as string[]);
  return [...v4, ...v6];
}

Deno.serve(erstelleHandler({
  anthropicKey: Deno.env.get("ANTHROPIC_API_KEY") || undefined,
  erlaubteHashes: (Deno.env.get("ERLAUBTE_SCHLUESSEL") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  erlaubteUrspruenge: (Deno.env.get("ERLAUBTE_URSPRUENGE") ?? "https://finanzdienste.github.io")
    .split(",").map((s) => s.trim()).filter(Boolean),
  tavilyKey: Deno.env.get("TAVILY_API_KEY") || undefined,
  aufloesen,
}));
