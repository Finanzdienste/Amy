/*
 * Eine Attrappe für alles, was die App draußen anspricht:
 *
 *   /auth/v1/...    Supabase Auth (anmelden, erneuern, abmelden, wer bin ich)
 *   /v1/messages    die Anthropic-API, antwortet mit einem gestreamten Text
 *                   samt Denkschritt, wie die echte API
 *
 * Jede Anfrage an /v1/messages wird mitgeschrieben, damit die Tests prüfen
 * können, was die Funktion wirklich verschickt hat. Es fließt kein Geld.
 *
 * Steuerwörter in der letzten Frage:
 *   „langsam“   die Antwort kommt in vielen kleinen Stücken (für „Stopp“)
 *   „xss“       die Antwort enthält HTML, das nicht ausgeführt werden darf
 *   „beispiel“  eine längere Antwort mit allem, was Markdown hergibt
 *   „berater“   Opus fragt erst den Berater (advisor), dann kommt der Text
 *   „still“     1,5 s nichts vor dem Text (für den Herzschlag)
 *   „pause“     wie „berater“, aber die erste Antwort endet mit pause_turn;
 *               die Fortsetzung bringt den Rat und den Text
 */

const BEISPIEL = `Gern! Hier ein kurzer Überblick, wie du **Sauerteig** ansetzt.

## Was du brauchst

- 50 g Roggenmehl (Type 1150)
- 50 ml lauwarmes Wasser
- ein Glas mit lockerem Deckel

## Ablauf

1. Mehl und Wasser verrühren und *zugedeckt* warm stellen.
2. Jeden Tag die Hälfte wegnehmen und neu füttern.
3. Nach etwa fünf Tagen riecht er angenehm säuerlich.

| Tag | Geruch | Blasen |
|-----|--------|-------:|
| 1 | nach Mehl | kaum |
| 3 | leicht sauer | einige |
| 5 | säuerlich | viele |

> Tipp: Je wärmer, desto schneller.

Für die Temperatur kannst du dir notieren: \`26 °C\`. Und als Code:

\`\`\`python
for tag in range(1, 6):
    print(f"Tag {tag}: füttern")
\`\`\``;

import http from 'node:http';

export const NUTZER = {
  'amy@test.de': { id: '11111111-1111-4111-8111-111111111111', passwort: 'geheim-amy' },
  'ich@test.de': { id: '22222222-2222-4222-8222-222222222222', passwort: 'geheim-ich' },
  'gast@test.de': { id: '33333333-3333-4333-8333-333333333333', passwort: 'geheim-gast' },
};

const nachId = Object.fromEntries(Object.entries(NUTZER).map(([email, n]) => [n.id, { ...n, email }]));

function lesen(req) {
  return new Promise((gut) => {
    let daten = '';
    req.on('data', (s) => { daten += s; });
    req.on('end', () => gut(daten));
  });
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

function letzteFrage(nachrichten) {
  const n = nachrichten.findLast((m) => m.role === 'user');
  if (typeof n.content === 'string') return n.content;
  return n.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

export async function starteAttrappe() {
  const anfragen = [];
  const kostenAbfragen = [];
  let zaehler = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const json = (status, daten) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(daten));
    };
    const roh = await lesen(req);

    if (url.pathname === '/auth/v1/token') {
      const daten = JSON.parse(roh || '{}');
      if (url.searchParams.get('grant_type') === 'password') {
        const n = NUTZER[daten.email];
        if (!n || n.passwort !== daten.password) {
          json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
          return;
        }
        json(200, {
          access_token: `tok-${n.id}`, refresh_token: `ref-${n.id}`, expires_in: 3600,
          user: { id: n.id, email: daten.email },
        });
        return;
      }
      const id = String(daten.refresh_token || '').replace(/^ref-/, '');
      if (!nachId[id]) {
        json(400, { error: 'invalid_grant' });
        return;
      }
      json(200, {
        access_token: `tok-${id}`, refresh_token: `ref-${id}`, expires_in: 3600,
        user: { id, email: nachId[id].email },
      });
      return;
    }

    if (url.pathname === '/auth/v1/logout') {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (url.pathname === '/auth/v1/user') {
      const id = String(req.headers.authorization || '').replace(/^Bearer tok-/, '');
      if (!nachId[id] || req.headers.apikey !== 'sb_publishable_test') {
        json(401, { msg: 'invalid JWT' });
        return;
      }
      json(200, { id, email: nachId[id].email, role: 'authenticated' });
      return;
    }

    // Kostenbericht der Admin-API: zwei Tage, zusammen 20 $ (in Cent)
    if (url.pathname === '/v1/organizations/cost_report') {
      kostenAbfragen.push(Object.fromEntries(url.searchParams));
      if (req.headers['x-api-key'] !== 'admin-test') {
        json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
        return;
      }
      json(200, {
        data: [
          { starting_at: '2026-11-01T00:00:00Z', ending_at: '2026-11-02T00:00:00Z', results: [{ currency: 'USD', amount: '1234.5' }] },
          { starting_at: '2026-11-02T00:00:00Z', ending_at: '2026-11-03T00:00:00Z', results: [{ currency: 'USD', amount: '765.5' }] },
        ],
        has_more: false,
        next_page: null,
      });
      return;
    }

    if (url.pathname === '/v1/messages') {
      const nr = ++zaehler;
      const koerper = JSON.parse(roh);
      const eintrag = {
        nr,
        koerper,
        koepfe: req.headers,
        abgebrochen: false,
        fertig: false,
      };
      anfragen.push(eintrag);
      // Das SDK ab 1.x schickt den Schlüssel als Bearer-Token, ältere als x-api-key.
      const schluessel = req.headers['x-api-key'] ||
        String(req.headers.authorization || '').replace(/^Bearer /, '');
      eintrag.schluessel = schluessel;
      if (schluessel !== 'test-schluessel') {
        json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
        return;
      }
      res.on('close', () => { if (!eintrag.fertig) eintrag.abgebrochen = true; });

      const frage = letzteFrage(koerper.messages);
      // Fortsetzung nach pause_turn: Die letzte Nachricht ist die angefangene Antwort.
      const fortsetzung = koerper.messages.at(-1).role === 'assistant';
      let text = `Antwort ${nr}: Das ist **wichtig**.\n\n- erstens\n- zweitens\n\nDu hast gefragt: ${frage}`;
      if (/xss/i.test(frage)) text = 'Hier <img src=x onerror="window.__xss=1"> und <script>window.__xss=2</script> Ende.';
      if (/beispiel/i.test(frage)) text = BEISPIEL;
      const langsam = /langsam/i.test(frage);
      const berater = /berater|pause/i.test(frage);
      const pausiert = /pause/i.test(frage) && !fortsetzung;

      const stuecke = langsam ? Array.from({ length: 200 }, (_, i) => `Wort${i} `) : text.match(/.{1,12}/gs);

      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'request-id': `req_${nr}` });
      const sende = (typ, daten) => res.write(`event: ${typ}\ndata: ${JSON.stringify({ type: typ, ...daten })}\n\n`);
      let index = 0;
      const block = (inhalt) => {
        sende('content_block_start', { index, content_block: inhalt });
        sende('content_block_stop', { index });
        index++;
      };

      sende('message_start', {
        message: {
          id: `msg_${nr}`, type: 'message', role: 'assistant', model: koerper.model, content: [],
          stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 1000, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 },
        },
      });
      if (!fortsetzung) {
        sende('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
        sende('content_block_delta', { index, delta: { type: 'signature_delta', signature: `sig-${nr}` } });
        sende('content_block_stop', { index });
        index++;
      }
      sende('ping', {});
      // „still“: lange nichts, wie wenn Claude lange nachdenkt
      if (/still/i.test(frage)) await warte(1500);
      // Der Berater: Opus ruft das Werkzeug advisor, der Rat kommt verschlüsselt.
      if (berater && !fortsetzung) {
        block({ type: 'server_tool_use', id: `srvtoolu_${nr}`, name: 'advisor', input: {} });
      }
      if (pausiert) {
        sende('message_delta', { delta: { stop_reason: 'pause_turn', stop_sequence: null }, usage: { output_tokens: 50 } });
        sende('message_stop', {});
        eintrag.fertig = true;
        res.end();
        return;
      }
      if (berater) {
        const zu = fortsetzung
          ? koerper.messages.at(-1).content.find((b) => b.type === 'server_tool_use').id
          : `srvtoolu_${nr}`;
        block({
          type: 'advisor_tool_result', tool_use_id: zu,
          content: { type: 'advisor_redacted_result', encrypted_content: `enc-${nr}`, stop_reason: 'end_turn' },
        });
      }
      sende('content_block_start', { index, content_block: { type: 'text', text: '' } });
      for (const s of stuecke) {
        if (res.destroyed) return;
        sende('content_block_delta', { index, delta: { type: 'text_delta', text: s } });
        await warte(langsam ? 40 : 5);
      }
      sende('content_block_stop', { index });
      const usage = { output_tokens: 500 };
      if (berater) {
        usage.iterations = [
          { type: 'message', input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 },
          { type: 'advisor_message', model: 'claude-fable-5-2', input_tokens: 3000, output_tokens: 800, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        ];
      }
      sende('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage });
      sende('message_stop', {});
      eintrag.fertig = true;
      res.end();
      return;
    }

    json(404, { msg: 'unbekannt' });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    anfragen,
    kostenAbfragen,
    schliessen: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}
