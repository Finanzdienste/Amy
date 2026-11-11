/*
 * Was eine Antwort ungefähr gekostet hat, in US-Dollar.
 *
 * Preise pro einer Million Tokens (Stand November 2026):
 *
 *                     Eingabe  Zwischenspeicher  Zwischenspeicher  Ausgabe
 *                              schreiben         lesen
 *   Claude Opus 5.5   4 $      5 $               0,20 $            20 $
 *   Claude Fable 5.2  8 $      10 $              0,20 $            40 $
 *
 * Opus schreibt die Antwort; Fable ist der Berater, den Opus bei schwierigen
 * Fragen fragen kann. Fables Anteil steht in usage.iterations als
 * „advisor_message“ und wird mit Fables Preisen gerechnet. Die Denkschritte
 * zählen zur Ausgabe. Springt ausnahmsweise ein anderes Modell ein, stimmt die
 * Zahl nicht ganz; sie bleibt eine Schätzung.
 */

export const PREISE = {
  opus: { eingabe: 4, cacheSchreiben: 5, cacheLesen: 0.2, ausgabe: 20 },
  fable: { eingabe: 8, cacheSchreiben: 10, cacheLesen: 0.2, ausgabe: 40 },
};

const n = (wert) => (Number.isFinite(wert) ? wert : 0);

function teil(nutzung, preis) {
  return (
    n(nutzung.input_tokens) * preis.eingabe +
    n(nutzung.cache_creation_input_tokens) * preis.cacheSchreiben +
    n(nutzung.cache_read_input_tokens) * preis.cacheLesen +
    n(nutzung.output_tokens) * preis.ausgabe
  ) / 1_000_000;
}

const preisFuer = (modell) => (/fable|mythos/.test(modell || '') ? PREISE.fable : PREISE.opus);

/* Nimmt eine usage oder, nach einer fortgesetzten Antwort, mehrere, und das
 * Modell, das geantwortet hat (Opus, wenn keins dasteht). */
export function kostenUSD(nutzung, modell = '') {
  if (!nutzung) return 0;
  if (Array.isArray(nutzung)) return nutzung.reduce((s, u) => s + kostenUSD(u, modell), 0);
  let summe = teil(nutzung, preisFuer(modell));
  for (const it of nutzung.iterations || []) {
    if (it?.type === 'advisor_message') {
      summe += teil(it, /fable|mythos/.test(it.model || '') ? PREISE.fable : PREISE.opus);
    }
  }
  return summe;
}

export function alsDollar(betrag) {
  if (betrag > 0 && betrag < 0.01) return 'unter 1 Cent';
  return betrag.toLocaleString('de-DE', { style: 'currency', currency: 'USD' });
}
