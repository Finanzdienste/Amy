/*
 * Macht aus Claudes Markdown sicheres HTML.
 *
 * Sicher heißt: Aller Text wird zuerst maskiert, danach kommen nur feste
 * Tags hinzu. Links gibt es nur zu http, https und mailto. So kann auch eine
 * Antwort, die HTML oder Skripte enthält, auf der Seite nichts ausführen.
 *
 * Bewusst klein gehalten: Absätze, Überschriften, Listen (auch verschachtelt),
 * Zitate, Codeblöcke, Tabellen, Trennlinien, fett, kursiv, durchgestrichen,
 * Code im Text und Links. Das deckt ab, was Claude im Gespräch schreibt.
 *
 * Halbfertiger Text, wie er beim Mitlesen ankommt, darf nichts zerbrechen:
 * Ein noch offener Codeblock wird einfach bis zum Ende als Code gezeigt.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function maskiere(text) {
  return String(text).replace(/[&<>"']/g, (z) => ESC[z]);
}

/* Platzhalter für bereits fertige Stücke (Code, Links), damit die folgenden
 * Ersetzungen sie nicht mehr anfassen. Die Steuerzeichen kommen in normalem
 * Text nicht vor; sie werden vorher entfernt. */
const AUF = '\u0001';
const ZU = '\u0002';

function zeilenText(text, ablage) {
  const merke = (html) => `${AUF}${ablage.push(html) - 1}${ZU}`;

  // Code im Text zuerst: Darin gilt keine weitere Formatierung.
  let s = text.replace(/(`{1,2})([^`\n]|[^`\n][\s\S]*?[^`\n])\1(?!`)/g,
    (_, __, code) => merke(`<code>${maskiere(code)}</code>`));

  s = maskiere(s);

  // [Text](Adresse)
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (ganz, linkText, adresse) => {
    if (!/^(https?:\/\/|mailto:)/i.test(adresse)) return ganz;
    return merke(`<a href="${adresse}" target="_blank" rel="noopener noreferrer">${linkText}</a>`);
  });

  // Nackte Adressen. Satzzeichen am Ende gehören nicht dazu.
  s = s.replace(/https?:\/\/[^\s<>"'\u0001\u0002]+/g, (adresse) => {
    let rest = '';
    while (/[.,;:!?)\]]$/.test(adresse)) {
      if (adresse.endsWith(')') && (adresse.match(/\(/g) || []).length >= (adresse.match(/\)/g) || []).length) break;
      rest = adresse.slice(-1) + rest;
      adresse = adresse.slice(0, -1);
    }
    return merke(`<a href="${adresse}" target="_blank" rel="noopener noreferrer">${adresse}</a>`) + rest;
  });

  s = s.replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w])__(?=\S)([^\n]*?\S)__(?!\w)/g, '$1<strong>$2</strong>');
  s = s.replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)([^\n]*?\S)~~/g, '<del>$1</del>');

  // Platzhalter zurück; ein Link kann Code enthalten, deshalb wiederholt.
  for (let i = 0; i < 3 && s.includes(AUF); i++) {
    s = s.replace(/\u0001(\d+)\u0002/g, (_, n) => ablage[Number(n)]);
  }
  return s;
}

function einrueckung(zeile) {
  return zeile.match(/^ */)[0].length;
}

function ausruecken(zeile, n) {
  let i = 0;
  while (i < n && zeile[i] === ' ') i++;
  return zeile.slice(i);
}

const RE_ZAUN = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const RE_UEBERSCHRIFT = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_LINIE = /^ {0,3}([-*_])( *\1){2,} *$/;
const RE_ZITAT = /^ {0,3}> ?/;
const RE_PUNKT = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const RE_TRENNER = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;

function listenpunkt(zeile) {
  const m = zeile.match(RE_PUNKT);
  if (!m) return null;
  const nummer = /\d/.test(m[2]) ? parseInt(m[2], 10) : null;
  return { tiefe: m[1].length, nummer, breite: m[1].length + m[2].length + 1, text: m[3] };
}

function istTabellenstart(zeilen, i) {
  return zeilen[i].includes('|') && i + 1 < zeilen.length &&
    zeilen[i + 1].includes('-') && RE_TRENNER.test(zeilen[i + 1]);
}

function istBlockstart(zeilen, i) {
  const z = zeilen[i];
  return RE_ZAUN.test(z) || RE_UEBERSCHRIFT.test(z) || RE_LINIE.test(z) ||
    RE_ZITAT.test(z) || RE_PUNKT.test(z) || istTabellenstart(zeilen, i);
}

function zellen(zeile) {
  let z = zeile.trim();
  if (z.startsWith('|')) z = z.slice(1);
  if (z.endsWith('|') && !z.endsWith('\\|')) z = z.slice(0, -1);
  return z.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

function bloecke(zeilen, ablage) {
  const aus = [];
  let i = 0;
  while (i < zeilen.length) {
    const zeile = zeilen[i];

    if (zeile.trim() === '') { i++; continue; }

    const zaun = zeile.match(RE_ZAUN);
    if (zaun) {
      const zeichen = zaun[1];
      const sprache = zaun[2];
      const code = [];
      i++;
      while (i < zeilen.length && !(zeilen[i].trim().startsWith(zeichen[0].repeat(zeichen.length)) &&
        /^ {0,3}(`{3,}|~{3,})\s*$/.test(zeilen[i]))) {
        code.push(zeilen[i]);
        i++;
      }
      i++; // schließender Zaun (oder Ende)
      const klasse = sprache ? ` class="sprache-${maskiere(sprache)}"` : '';
      aus.push(`<pre><code${klasse}>${maskiere(code.join('\n'))}</code></pre>`);
      continue;
    }

    const kopf = zeile.match(RE_UEBERSCHRIFT);
    if (kopf) {
      const stufe = kopf[1].length;
      aus.push(`<h${stufe}>${zeilenText(kopf[2], ablage)}</h${stufe}>`);
      i++;
      continue;
    }

    if (RE_LINIE.test(zeile)) { aus.push('<hr>'); i++; continue; }

    if (RE_ZITAT.test(zeile)) {
      const innen = [];
      while (i < zeilen.length && zeilen[i].trim() !== '' && RE_ZITAT.test(zeilen[i])) {
        innen.push(zeilen[i].replace(RE_ZITAT, ''));
        i++;
      }
      aus.push(`<blockquote>${bloecke(innen, ablage)}</blockquote>`);
      continue;
    }

    if (istTabellenstart(zeilen, i)) {
      const koepfe = zellen(zeilen[i]);
      const ausrichtung = zellen(zeilen[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '');
      const stil = (n) => (ausrichtung[n] ? ` style="text-align:${ausrichtung[n]}"` : '');
      i += 2;
      const reihen = [];
      while (i < zeilen.length && zeilen[i].trim() !== '' && zeilen[i].includes('|')) {
        reihen.push(zellen(zeilen[i]));
        i++;
      }
      const th = koepfe.map((c, n) => `<th${stil(n)}>${zeilenText(c, ablage)}</th>`).join('');
      const tr = reihen.map((r) =>
        `<tr>${koepfe.map((_, n) => `<td${stil(n)}>${zeilenText(r[n] ?? '', ablage)}</td>`).join('')}</tr>`).join('');
      aus.push(`<div class="tabelle"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
      continue;
    }

    const punkt = listenpunkt(zeile);
    if (punkt) {
      const geordnet = punkt.nummer !== null;
      const basis = punkt.tiefe;
      const eintraege = [];
      let aktuell = null;
      let breite = 0;
      while (i < zeilen.length) {
        const z = zeilen[i];
        const p = listenpunkt(z);
        if (p && p.tiefe <= basis + 1) {
          if ((p.nummer !== null) !== geordnet) break;
          aktuell = [p.text];
          breite = p.breite;
          eintraege.push(aktuell);
          i++;
          continue;
        }
        if (z.trim() === '') {
          let j = i + 1;
          while (j < zeilen.length && zeilen[j].trim() === '') j++;
          const weiter = j < zeilen.length && (einrueckung(zeilen[j]) > basis + 1 ||
            ((listenpunkt(zeilen[j])?.nummer !== null) === geordnet && listenpunkt(zeilen[j])?.tiefe <= basis + 1));
          if (!weiter) break;
          aktuell.push('');
          i++;
          continue;
        }
        if (einrueckung(z) > basis) {
          aktuell.push(ausruecken(z, breite));
          i++;
          continue;
        }
        // Fortsetzungszeile ohne Einrückung direkt unter dem Punkt
        if (aktuell[aktuell.length - 1] !== '' && !istBlockstart(zeilen, i)) {
          aktuell.push(z.trim());
          i++;
          continue;
        }
        break;
      }
      const tag = geordnet ? 'ol' : 'ul';
      const start = geordnet && punkt.nummer !== 1 ? ` start="${punkt.nummer}"` : '';
      const lis = eintraege.map((e) => {
        // Der erste Absatz eines Punkts steht ohne <p>, sonst wirken Listen luftig.
        const html = bloecke(e, ablage).replace(/^<p>([\s\S]*?)<\/p>/, '$1');
        return `<li>${html}</li>`;
      }).join('');
      aus.push(`<${tag}${start}>${lis}</${tag}>`);
      continue;
    }

    // Absatz: bis zur Leerzeile oder bis etwas anderes beginnt.
    const absatz = [zeile];
    i++;
    while (i < zeilen.length && zeilen[i].trim() !== '' && !istBlockstart(zeilen, i)) {
      absatz.push(zeilen[i]);
      i++;
    }
    aus.push(`<p>${absatz.map((z) => zeilenText(z.trim(), ablage)).join('<br>')}</p>`);
  }
  return aus.join('');
}

export function markdownZuHtml(text) {
  const sauber = String(text ?? '')
    .replace(/[\u0001\u0002]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '    ');
  return bloecke(sauber.split('\n'), []);
}
