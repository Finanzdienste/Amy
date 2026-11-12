/*
 * Prüfungen ohne Browser: Markdown, das Zerlegen des Antwortstroms und die
 * Kostenrechnung.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownZuHtml, maskiere } from '../js/markdown.js';
import { textAus, zerlegeSSE } from '../js/api.js';
import { alsDollar, kostenUSD } from '../js/kosten.js';

const md = markdownZuHtml;

test('maskiert HTML vollständig', () => {
  assert.equal(maskiere(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('HTML und Skripte in Antworten bleiben Text', () => {
  const html = md('Hallo <img src=x onerror="alert(1)"> <script>alert(2)</script>');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&lt;img'));
});

test('Links nur zu http, https und mailto', () => {
  assert.equal(md('[gut](https://example.org/a?b=1&c=2)'),
    '<p><a href="https://example.org/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">gut</a></p>');
  assert.ok(!md('[böse](javascript:alert(1))').includes('<a'));
  assert.ok(!md('[böse](data:text/html,x)').includes('<a'));
  assert.ok(md('[Mail](mailto:a@b.de)').includes('href="mailto:a@b.de"'));
  // Anführungszeichen können das Attribut nicht verlassen
  assert.ok(!md('[x](https://a.de/"onmouseover="alert(1))').includes('" onmouseover'));
});

test('nackte Adressen werden Links, Satzzeichen bleiben draußen', () => {
  assert.equal(md('Siehe https://example.org/pfad.'),
    '<p>Siehe <a href="https://example.org/pfad" target="_blank" rel="noopener noreferrer">https://example.org/pfad</a>.</p>');
  assert.ok(md('(https://de.wikipedia.org/wiki/Test_(Begriff))').includes('href="https://de.wikipedia.org/wiki/Test_(Begriff)"'));
});

test('fett, kursiv, durchgestrichen, Code', () => {
  assert.equal(md('**fett** und *kursiv* und ~~weg~~ und `a<b`'),
    '<p><strong>fett</strong> und <em>kursiv</em> und <del>weg</del> und <code>a&lt;b</code></p>');
  assert.equal(md('snake_case_name bleibt'), '<p>snake_case_name bleibt</p>');
  assert.equal(md('2*3*4'), '<p>2*3*4</p>');
  assert.equal(md('`**nicht fett**`'), '<p><code>**nicht fett**</code></p>');
});

test('Absätze und Zeilenumbrüche', () => {
  assert.equal(md('eins\nzwei\n\ndrei'), '<p>eins<br>zwei</p><p>drei</p>');
});

test('Überschriften und Trennlinie', () => {
  assert.equal(md('## Titel\n\n---\n\nText'), '<h2>Titel</h2><hr><p>Text</p>');
});

test('Listen, auch verschachtelt und nummeriert', () => {
  assert.equal(md('- a\n- b\n  - b1\n  - b2\n- c'),
    '<ul><li>a</li><li>b<ul><li>b1</li><li>b2</li></ul></li><li>c</li></ul>');
  assert.equal(md('1. eins\n2. zwei'), '<ol><li>eins</li><li>zwei</li></ol>');
  assert.equal(md('3. drei\n4. vier'), '<ol start="3"><li>drei</li><li>vier</li></ol>');
  assert.equal(md('Liste:\n- a\n- b'), '<p>Liste:</p><ul><li>a</li><li>b</li></ul>');
});

test('Listenpunkte mit mehreren Absätzen', () => {
  assert.equal(md('1. Erster\n\n   Mehr dazu\n2. Zweiter'),
    '<ol><li>Erster<p>Mehr dazu</p></li><li>Zweiter</li></ol>');
});

test('Codeblock, auch wenn er noch nicht geschlossen ist', () => {
  assert.equal(md('```js\nconst a = 1 < 2;\n```'),
    '<pre><code class="sprache-js">const a = 1 &lt; 2;</code></pre>');
  assert.equal(md('```\nnoch offen'), '<pre><code>noch offen</code></pre>');
  assert.equal(md('```\n**nicht fett**\n```'), '<pre><code>**nicht fett**</code></pre>');
});

test('Zitate', () => {
  assert.equal(md('> zitiert\n> weiter'), '<blockquote><p>zitiert<br>weiter</p></blockquote>');
});

test('Tabellen', () => {
  const html = md('| A | B |\n|:--|--:|\n| 1 | **2** |\n| 3 | 4 |');
  assert.equal(html,
    '<div class="tabelle"><table><thead><tr><th>A</th><th style="text-align:right">B</th></tr></thead>' +
    '<tbody><tr><td>1</td><td style="text-align:right"><strong>2</strong></td></tr>' +
    '<tr><td>3</td><td style="text-align:right">4</td></tr></tbody></table></div>');
  assert.ok(md('| A |\n|:-:|\n| 1 |').includes('<th style="text-align:center">A</th>'));
});

test('halbe Tabelle beim Mitlesen bricht nichts', () => {
  assert.equal(md('| A | B |'), '<p>| A | B |</p>');
});

test('Steuerzeichen im Text stören die Platzhalter nicht', () => {
  assert.equal(md('a\u00010\u0002b `c`'), '<p>a0b <code>c</code></p>');
});

test('Antwortstrom: Ereignisse und Rest', () => {
  const { ereignisse, rest } = zerlegeSSE('data: {"t":"text","d":"Hal"}\n\n: ping\n\ndata: {"t":"te');
  assert.deepEqual(ereignisse, [{ t: 'text', d: 'Hal' }]);
  assert.equal(rest, 'data: {"t":"te');
  const weiter = zerlegeSSE(`${rest}xt","d":"lo"}\n\n`);
  assert.deepEqual(weiter.ereignisse, [{ t: 'text', d: 'lo' }]);
  assert.equal(weiter.rest, '');
});

test('sichtbarer Text einer Antwort', () => {
  assert.equal(textAus([
    { type: 'thinking', thinking: '', signature: 's' },
    { type: 'text', text: 'Hallo ' },
    { type: 'text', text: 'Welt' },
  ]), 'Hallo Welt');
  assert.equal(textAus('nur Text'), 'nur Text');
});

test('Kosten', () => {
  const usd = kostenUSD({ input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 0, output_tokens: 100_000 });
  assert.ok(Math.abs(usd - (4 + 0.2 + 2)) < 1e-9);
  assert.equal(kostenUSD(null), 0);
  // Der Berater mit Fables Preisen, mehrere Teile werden addiert
  const mitBerater = kostenUSD({
    input_tokens: 0, output_tokens: 0,
    iterations: [{ type: 'advisor_message', model: 'claude-fable-5-2', input_tokens: 1_000_000, output_tokens: 1_000_000 }],
  });
  assert.ok(Math.abs(mitBerater - 48) < 1e-9);
  assert.ok(Math.abs(kostenUSD([{ output_tokens: 1_000_000 }, { output_tokens: 1_000_000 }]) - 40) < 1e-9);
  // Antwortet Fable selbst, gilt Fables Preis
  assert.ok(Math.abs(kostenUSD({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'claude-fable-5-2') - 48) < 1e-9);
  // Sonnet und Haiku mit ihren Preisen, Sonnets Berater mit Fables
  assert.ok(Math.abs(kostenUSD({ input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'claude-sonnet-5-5') - 12.1) < 1e-9);
  assert.ok(Math.abs(kostenUSD({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, 'claude-haiku-5-5') - 0.6) < 1e-9);
  assert.ok(Math.abs(kostenUSD({ output_tokens: 0, iterations: [{ type: 'advisor_message', model: 'claude-fable-5-2', output_tokens: 1_000_000 }] }, 'claude-sonnet-5-5') - 40) < 1e-9);
  assert.equal(alsDollar(0.004), 'unter 1 Cent');
});
