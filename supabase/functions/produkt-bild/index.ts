/*
 * Einstieg der Supabase-Funktion „produkt-bild“ (siehe handler.ts). Nimmt
 * dieselben Secrets wie api-kosten: ANTHROPIC_API_KEY (seine Prüfsumme darf
 * fragen) und, wenn nötig, ERLAUBTE_SCHLUESSEL; dazu ERLAUBTE_URSPRUENGE.
 * Die IP-Adressen hinter einem Namen fragt sie bei Deno nach – geht das
 * nicht, bleibt es bei der Prüfung des Namens.
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
  aufloesen,
}));
