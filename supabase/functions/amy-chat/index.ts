/*
 * Einstieg der Supabase-Funktion „amy-chat“. Liest die Einstellungen aus der
 * Umgebung und übergibt an handler.ts.
 *
 * Secrets, die in Supabase gesetzt sein müssen (Edge Functions → Secrets):
 *
 *   ANTHROPIC_API_KEY    der Schlüssel aus der Anthropic Console
 *   ERLAUBTE_NUTZER      Nutzer-IDs aus Supabase Auth, durch Komma getrennt
 *
 * Optional:
 *
 *   ANTHROPIC_ADMIN_KEY  Admin-Schlüssel aus der Console (sk-ant-admin…), nur
 *                        damit die App anzeigen kann, wie viel vom Guthaben
 *                        schon verbraucht ist; ohne ihn keine Anzeige
 *   API_GUTHABEN_USD     monatliches Guthaben in US-Dollar, ohne Angabe 100
 *   ABRECHNUNG_TAG       Tag im Monat, an dem das Guthaben neu beginnt, ohne
 *                        Angabe der 1.
 *
 *   ERLAUBTE_URSPRUENGE  von welchen Adressen die App aufgerufen werden darf,
 *                        durch Komma getrennt; ohne Angabe nur GitHub Pages
 *
 * SUPABASE_URL und die Schlüssel des Projekts setzt Supabase selbst.
 */

import { erstelleHandler } from "./handler.ts";

function liste(name: string, vorgabe = ""): string[] {
  return (Deno.env.get(name) ?? vorgabe)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function publishableKey(): string {
  const neu = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (neu) {
    try {
      const schluessel = JSON.parse(neu);
      if (schluessel.default) return schluessel.default;
    } catch {
      // weiter mit dem alten Schlüssel
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

Deno.serve(erstelleHandler({
  anthropicKey: Deno.env.get("ANTHROPIC_API_KEY") || undefined,
  adminKey: Deno.env.get("ANTHROPIC_ADMIN_KEY") || undefined,
  guthabenUsd: Number(Deno.env.get("API_GUTHABEN_USD")) || 100,
  abrechnungTag: Number(Deno.env.get("ABRECHNUNG_TAG")) || 1,
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  publishableKey: publishableKey(),
  erlaubteNutzer: liste("ERLAUBTE_NUTZER"),
  erlaubteUrspruenge: liste(
    "ERLAUBTE_URSPRUENGE",
    "https://finanzdienste.github.io",
  ),
}));
