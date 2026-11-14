/* Startet die Funktion api-kosten lokal für die Tests, gegen tests/attrappe.mjs. */

import { erstelleHandler } from "../supabase/functions/api-kosten/handler.ts";

Deno.serve(
  {
    port: Number(Deno.env.get("PORT") ?? 0),
    hostname: "127.0.0.1",
    onListen: ({ port }) => console.log(`bereit ${port}`),
  },
  erstelleHandler({
    anthropicKey: Deno.env.get("ANTHROPIC_API_KEY") || undefined,
    erlaubteHashes: (Deno.env.get("ERLAUBTE_SCHLUESSEL") ?? "").split(",").filter(Boolean),
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    secretKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || undefined,
    erlaubteUrspruenge: (Deno.env.get("ERLAUBTE_URSPRUENGE") ?? "").split(",").filter(Boolean),
  }),
);
