/*
 * Was eine Antwort ungefähr gekostet hat, in US-Dollar.
 *
 * Preise für Claude Opus 5.5 pro einer Million Tokens (Stand November 2026):
 * Eingabe 4 $, Eingabe in den Zwischenspeicher schreiben 5 $, aus dem
 * Zwischenspeicher lesen 0,20 $, Ausgabe 20 $. Die Denkschritte zählen zur
 * Ausgabe. Springt ausnahmsweise ein anderes Modell ein, stimmt die Zahl
 * nicht ganz; sie bleibt eine Schätzung.
 */

export const PREISE = { eingabe: 4, cacheSchreiben: 5, cacheLesen: 0.2, ausgabe: 20 };

export function kostenUSD(nutzung) {
  if (!nutzung) return 0;
  const n = (wert) => (Number.isFinite(wert) ? wert : 0);
  const summe =
    n(nutzung.input_tokens) * PREISE.eingabe +
    n(nutzung.cache_creation_input_tokens) * PREISE.cacheSchreiben +
    n(nutzung.cache_read_input_tokens) * PREISE.cacheLesen +
    n(nutzung.output_tokens) * PREISE.ausgabe;
  return summe / 1_000_000;
}

export function alsDollar(betrag) {
  if (betrag > 0 && betrag < 0.01) return 'unter 1 Cent';
  return betrag.toLocaleString('de-DE', { style: 'currency', currency: 'USD' });
}
