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
  const n = nachrichten[nachrichten.length - 1];
  if (typeof n.content === 'string') return n.content;
  return n.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

export async function starteAttrappe() {
  const anfragen = [];
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
      let text = `Antwort ${nr}: Das ist **wichtig**.\n\n- erstens\n- zweitens\n\nDu hast gefragt: ${frage}`;
      if (/xss/i.test(frage)) text = 'Hier <img src=x onerror="window.__xss=1"> und <script>window.__xss=2</script> Ende.';
      if (/beispiel/i.test(frage)) text = BEISPIEL;
      const langsam = /langsam/i.test(frage);
      const stuecke = langsam ? Array.from({ length: 200 }, (_, i) => `Wort${i} `) : text.match(/.{1,12}/gs);

      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'request-id': `req_${nr}` });
      const sende = (typ, daten) => res.write(`event: ${typ}\ndata: ${JSON.stringify({ type: typ, ...daten })}\n\n`);

      sende('message_start', {
        message: {
          id: `msg_${nr}`, type: 'message', role: 'assistant', model: koerper.model, content: [],
          stop_reason: null, stop_sequence: null,
          usage: { input_tokens: 1000, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 },
        },
      });
      sende('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
      sende('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: `sig-${nr}` } });
      sende('content_block_stop', { index: 0 });
      sende('ping', {});
      sende('content_block_start', { index: 1, content_block: { type: 'text', text: '' } });
      for (const s of stuecke) {
        if (res.destroyed) return;
        sende('content_block_delta', { index: 1, delta: { type: 'text_delta', text: s } });
        await warte(langsam ? 40 : 5);
      }
      sende('content_block_stop', { index: 1 });
      sende('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 500 } });
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
    schliessen: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }),
  };
}
