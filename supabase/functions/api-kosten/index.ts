/*
 * Einstieg der Supabase-Funktion „api-kosten“ (siehe handler.ts). Braucht
 * dasselbe Secret ANTHROPIC_API_KEY wie amy-chat; SUPABASE_URL und den
 * geheimen Schlüssel setzt Supabase selbst. Optional ERLAUBTE_URSPRUENGE wie
 * bei amy-chat.
 */

import { erstelleHandler } from "./handler.ts";

function secretKey(): string {
  const neu = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (neu) {
    try {
      const schluessel = JSON.parse(neu);
      if (schluessel.default) return schluessel.default;
    } catch {
      // weiter mit dem alten Schlüssel
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

Deno.serve(erstelleHandler({
  anthropicKey: Deno.env.get("ANTHROPIC_API_KEY") || undefined,
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  secretKey: secretKey() || undefined,
  erlaubteUrspruenge: (Deno.env.get("ERLAUBTE_URSPRUENGE") ?? "https://finanzdienste.github.io")
    .split(",").map((s) => s.trim()).filter(Boolean),
}));
