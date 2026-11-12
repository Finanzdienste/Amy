/*
 * Startet die Funktion amy-chat lokal für die Tests. Alles kommt aus der
 * Umgebung; ANTHROPIC_BASE_URL und SUPABASE_URL zeigen auf tests/attrappe.mjs.
 */

import { erstelleHandler } from "../supabase/functions/amy-chat/handler.ts";

const liste = (name: string) =>
  (Deno.env.get(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);

Deno.serve(
  {
    port: Number(Deno.env.get("PORT") ?? 0),
    hostname: "127.0.0.1",
    onListen: ({ port }) => console.log(`bereit ${port}`),
  },
  erstelleHandler({
    anthropicKey: Deno.env.get("ANTHROPIC_API_KEY") || undefined,
    secretKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || undefined,
    guthabenUsd: Number(Deno.env.get("API_GUTHABEN_USD")) || 100,
    abrechnungTag: Number(Deno.env.get("ABRECHNUNG_TAG")) || 1,
    anthropicBaseUrl: Deno.env.get("ANTHROPIC_BASE_URL"),
    supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
    publishableKey: "sb_publishable_test",
    erlaubteNutzer: liste("ERLAUBTE_NUTZER"),
    erlaubteUrspruenge: liste("ERLAUBTE_URSPRUENGE"),
  }),
);
