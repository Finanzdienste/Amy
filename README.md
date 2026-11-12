# Frag mal

Eine kleine private Chat-App mit Claude Opus 5.5, gebaut für zwei Personen.
Sie läuft im Browser und lässt sich auf dem Handy wie eine App auf den
Home-Bildschirm legen. Bezahlt wird über das API-Guthaben in der Anthropic
Console, nicht über ein Claude-Abo.

**Adresse:** https://finanzdienste.github.io/Amy/

## Was die App kann

- **Einführung:** Beim ersten Öffnen auf einem Gerät begrüßt die App und
  zeigt auf dem Handy, wie man sie auf den Home-Bildschirm legt. Das kommt
  absichtlich *vor* der Anmeldung: Auf dem iPhone hat die App auf dem
  Home-Bildschirm einen eigenen Speicher, getrennt von Safari. Nach der ersten
  Anmeldung eines Kontos folgen vier Seiten: was man mit Claude machen kann,
  wie die App funktioniert, was man wissen sollte (Fehler, kein Internet,
  Datenschutz), und „Über mich“ zum gleich Ausfüllen. Unter „Über mich &
  Einstellungen“ lässt sie sich wieder aufrufen.
- **Beispiele zum Antippen** im leeren Gespräch. Sie füllen nur das
  Eingabefeld; abgeschickt wird erst mit ↑.
- **Gespräche** wie im gewohnten Chat. Die Antwort erscheint, während sie
  entsteht, und lässt sich mit dem Stopp-Knopf anhalten.
- **Mehrere Gespräche** in einer Liste. Auf dem Handy zieht man sie über
  ☰ heraus, am Rechner steht sie links.
- **Über mich:** Ein paar Sätze über sich, die Claude zu Beginn jedes neuen
  Gesprächs mitbekommt, etwa den Namen oder wie man Antworten am liebsten hat.
- **Markdown:** Überschriften, Listen, Tabellen, Code und Links werden
  ordentlich dargestellt.
- **Verbrauch:** Unter „Über mich & Einstellungen“ steht, was die Antworten
  auf diesem Gerät im laufenden Monat ungefähr gekostet haben.

Noch nicht dabei sind Bilder und PDFs, Websuche und ein Gedächtnis über
Gespräche hinweg. Das wäre der nächste Schritt.

## Einrichten

Einmalig, in dieser Reihenfolge.

**1. API-Schlüssel in der Anthropic Console**
([platform.claude.com](https://platform.claude.com))

- Unter *Workspaces* einen eigenen Workspace anlegen, etwa „Frag mal“, und
  dort ein **Monatslimit** setzen. So kann die App nie mehr verbrauchen als
  das, und ihr Verbrauch steht getrennt da.
- In diesem Workspace einen API-Schlüssel erzeugen und kopieren. Er wird nur
  einmal angezeigt.

**2. Konten in Supabase anlegen**

Im Projekt „Finanzdienste's Project“ unter *Authentication → Users → Add
user → Create new user*. Für jede Person E-Mail und Passwort eintragen und
*Auto Confirm User* anhaken. Eine Registrierung gibt es in der App nicht.

**3. Secrets für die Funktion setzen**

Unter *Edge Functions → Secrets*:

| Name | Inhalt |
|---|---|
| `ANTHROPIC_API_KEY` | der Schlüssel aus Schritt 1 |
| `ERLAUBTE_NUTZER` | die *User UID* der beiden Konten aus Schritt 2, durch Komma getrennt |

Nur wer in `ERLAUBTE_NUTZER` steht, bekommt Antworten. Eine gültige Anmeldung
allein reicht nicht, denn im selben Supabase-Projekt könnten auch andere
Konten liegen.

**4. GitHub Pages einschalten**

Im Repository unter *Settings → Pages → Build and deployment*: Source *Deploy
from a branch*, Branch `main`, Ordner `/ (root)`. Nach ein, zwei Minuten ist
die App unter der Adresse oben erreichbar.

**5. Auf dem Handy**

Die Adresse in Safari öffnen, anmelden, dann *Teilen → Zum Home-Bildschirm*.
Das ist mehr als Bequemlichkeit: Bei einer Seite, die nur im Browser offen
war, darf Safari die gespeicherten Gespräche nach einer Woche ohne Besuch
löschen. Bei einer App auf dem Home-Bildschirm tut es das nicht.

## Wie es funktioniert

```
Handy / Browser  ──►  Supabase-Funktion amy-chat  ──►  Anthropic API
  (GitHub Pages)        prüft die Anmeldung,             Claude Opus 5.5
  Gespräche liegen      hält den API-Schlüssel,
  nur hier              speichert nichts
```

Die App selbst ist eine statische Seite ohne Abhängigkeiten und ohne
Bauschritt. Sie meldet sich bei Supabase Auth an und schickt bei jeder Frage
das ganze Gespräch an die Funktion `amy-chat`. Die Funktion prüft, wem die
Anmeldung gehört, fragt Claude und reicht die Antwort Stück für Stück weiter.

Der API-Schlüssel steht nur als Secret in Supabase. In der App steht er nie,
denn alles auf GitHub Pages ist öffentlich lesbar. Der „publishable key“ in
`js/config.js` darf öffentlich sein: Er erlaubt nur die Anmeldung.

Einige Einzelheiten haben Gründe, die man dem Code nicht ansieht:

- **Gespräche wachsen nur hinten.** Claudes Antworten werden mit allen
  Blöcken gespeichert, wie die API sie liefert, auch mit den unsichtbaren
  Denkschritten, und gehen beim nächsten Mal unverändert mit. Der Systemtext
  wird beim Anlegen eines Gesprächs festgehalten (`kontext`) und danach nie
  geändert; deshalb gilt ein neues „Über mich“ erst ab dem nächsten neuen
  Gespräch. Würde sich davor etwas ändern, verlöre Claude seine früheren
  Denkschritte, und der Zwischenspeicher bei Anthropic griffe nicht mehr.
- **Zwischenspeicher (Prompt Caching).** Der schon bekannte Teil eines
  Gesprächs kostet beim nächsten Mal nur ein Zwanzigstel, solange zwischen
  zwei Fragen nicht mehr als ein paar Minuten liegen.
- **Ausweichmodell.** Lehnt Opus eine Anfrage aus Sicherheitsgründen ab,
  beantwortet ein anderes Claude-Modell sie im selben Aufruf
  (`fallbacks: "default"`), statt dass die Antwort leer bleibt.
- **Berater.** Opus kann bei schwierigen Fragen Claude Fable 5.2 um Rat
  fragen (Advisor-Werkzeug), so oft es will, ohne Grenze. Wann, entscheidet
  Opus selbst; der Systemtext sagt nur, wofür sich das lohnt. Den Rat liefert
  die API verschlüsselt, er geht wie alles andere unverändert ins Gespräch
  zurück. Das Werkzeug ist in jedem Gespräch gleich und darf sich nicht
  ändern (sonst verliert Claude frühere Denkschritte). Während Opus fragt,
  zeigt die App „fragt Fable um Rat“. Pausiert eine Antwort dabei
  (`pause_turn`), setzt die Funktion sie selbst fort.
- **Modell und Aufwand wählbar.** Unter „Über mich & Einstellungen“: Opus 5.5
  mit Advisor (Vorgabe), Opus 5.5 ohne Advisor, Sonnet 5.5 mit Advisor, Haiku 5.5
  oder Fable 5.2; Aufwand von „Niedrig“ bis „Maximal“ (Vorgabe „Mittel“). Die
  Wahl wird mit dem Gespräch festgehalten wie „Über mich“ und gilt ab dem
  nächsten neuen Gespräch. Die Funktion prüft beides gegen eine feste Liste.
- **API-Guthaben in Prozent.** Unten in der Gesprächsliste und in den
  Einstellungen steht, wie viel vom monatlichen API-Guthaben schon weg ist.
  Die Zahl kommt aus Anthropics Kostenbericht (Admin-API) und umfasst alles,
  was über die Organisation läuft, auch andere Apps. Dafür braucht die
  Funktion das Secret `ANTHROPIC_ADMIN_KEY` (ein Admin-Schlüssel aus der
  Console, nur zum Lesen); ohne ihn bleibt die Anzeige weg. Optional:
  `API_GUTHABEN_USD` (Vorgabe 100) und `ABRECHNUNG_TAG` (Tag, an dem das
  Guthaben neu beginnt, Vorgabe 1).
- **Neuigkeiten.** Nach einer Neuerung zeigt die App einmal je Konto und Gerät
  ein kleines Fenster (`NEUIGKEIT` in `js/app.js`); wer gerade die Einführung
  gesehen hat, bekommt es nicht.

## Was es kostet

Opus 5.5 kostet 4 $ pro Million Eingabe-Tokens und 20 $ pro Million
Ausgabe-Tokens; die Denkschritte zählen zur Ausgabe. Eine kurze Frage mit
Antwort liegt bei 1 bis 3 Cent, ein Gespräch mit zehn Nachrichten bei 20 bis
40 Cent. Lange Gespräche werden teurer, weil jedes Mal der ganze Verlauf
mitgeht; der Zwischenspeicher dämpft das.

Fragt Opus den Berater, kommt Fable 5.2 dazu: 8 $ pro Million Eingabe-Tokens
und 40 $ pro Million Ausgabe-Tokens, also doppelt so viel wie Opus. Bezahlt
wird das nur bei Fragen, bei denen Opus wirklich fragt. Die Schätzung unter
„Verbrauch“ rechnet Fables Anteil mit Fables Preisen.

Sonnet 5.5 kostet die Hälfte von Opus (2 $ / 10 $), Haiku 5.5 fast nichts
(0,10 $ / 0,50 $). Fable 5.2 selbst kostet doppelt so viel wie Opus.

Das monatliche API-Guthaben aus dem Abo verfällt am Ende jedes
Abrechnungszeitraums. Ist es aufgebraucht, sagt die App das, und es geht
erst im nächsten Monat weiter, sofern in der Console kein weiteres Guthaben
liegt.

## Datenschutz

- Gespräche und „Über mich“ liegen nur auf dem Gerät, im Speicher des
  Browsers (IndexedDB), getrennt nach Konto.
- Für jede Antwort geht das Gespräch über die Funktion an Anthropic. Die
  Funktion speichert nichts und schreibt keine Inhalte ins Protokoll.
- Ein Gespräch, das auf dem Handy geführt wurde, ist auf dem Rechner nicht
  zu sehen, und umgekehrt.

## Grenzen

- **Laufzeit:** Supabase beendet eine Funktion im kostenlosen Tarif nach 150
  Sekunden. Eine sehr lange Antwort kann deshalb mittendrin abbrechen. Was
  bis dahin angekommen ist, bleibt stehen, und „weiter“ setzt fort.
- **Kein Internet:** Claude kann in dieser App nichts nachschlagen und weiß
  das auch.

## Entwickeln und testen

```
npm install
npm test
```

Die Tests brauchen kein Guthaben und kein Netz zu Anthropic. `tests/attrappe.mjs`
spielt Supabase Auth und die Anthropic-API nach; die Funktion läuft dabei
echt, mit Deno, wie bei Supabase.

- `tests/einheit.test.mjs`: Markdown (auch dass HTML in Antworten nichts
  ausführen kann), der Antwortstrom, die Kostenrechnung
- `tests/funktion.test.mjs`: die Funktion allein – wer fragen darf, was an
  die API geht, Fehler, Abbruch
- `tests/app.test.mjs`: die ganze App im Browser, vom Anmelden bis zum
  Abmelden, auch in der schmalen Ansicht

`npm run serve` zeigt die App lokal unter http://localhost:8299/ (mit der
echten Konfiguration).

**Funktion neu veröffentlichen:** mit der Supabase CLI
`supabase functions deploy amy-chat --no-verify-jwt`. Die Funktion prüft die
Anmeldung selbst, deshalb ist die Prüfung durch die Plattform aus
(siehe `supabase/config.toml`).

**Neue Fassung der App:** In `js/app.js` `FASSUNG` hochzählen. Kommen
Dateien dazu oder fallen weg, auch `SHELL` und `VERSION` in `sw.js`
anpassen.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html`, `css/app.css` | Gerüst und Aussehen |
| `js/app.js` | die Oberfläche |
| `js/einfuehrung.js` | Einführung vor und nach der ersten Anmeldung |
| `js/api.js` | Anfrage an die Funktion, Antwortstrom lesen |
| `js/auth.js` | Anmeldung bei Supabase |
| `js/store.js` | Speicher auf dem Gerät |
| `js/markdown.js` | Markdown zu sicherem HTML |
| `js/kosten.js` | Kostenrechnung |
| `js/config.js` | Adressen von Supabase und der Funktion |
| `sw.js`, `manifest.webmanifest`, Icons | App auf dem Home-Bildschirm, Start ohne Netz |
| `supabase/functions/amy-chat/` | die Funktion |
| `tests/` | die Tests |
