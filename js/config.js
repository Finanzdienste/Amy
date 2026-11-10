/*
 * Wo die App ihren Server findet.
 *
 * Beides darf öffentlich sein: Die Adresse ist ohnehin sichtbar, und der
 * „publishable key“ ist laut Supabase genau für Webseiten gedacht. Er erlaubt
 * nur die Anmeldung. Wer fragen darf, entscheidet die Funktion amy-chat
 * anhand der Liste ERLAUBTE_NUTZER.
 *
 * Der Anthropic-Schlüssel steht hier nicht und darf hier nie stehen.
 */

export const KONFIG = {
  supabaseUrl: 'https://vjyohppohmvhhxgwouti.supabase.co',
  publishableKey: 'sb_publishable_wTUNShIKMFjCOmZzQuuN-A_vFHPkKUI',
  funktionUrl: 'https://vjyohppohmvhhxgwouti.supabase.co/functions/v1/amy-chat',
};
