/*
 * Die Einführung: ein paar Seiten zum Durchtippen, beim ersten Öffnen der
 * App (vor der Anmeldung) und nach der ersten Anmeldung eines Kontos.
 *
 * Vor der Anmeldung kommt auf dem Handy zuerst die Bitte, die App auf den
 * Home-Bildschirm zu legen. Das muss vor dem Anmelden passieren: Auf dem
 * iPhone hat die App auf dem Home-Bildschirm einen eigenen Speicher, getrennt
 * von Safari. Wer sich erst in Safari anmeldet, müsste es dort noch einmal tun.
 *
 * Die Texte hier sind fest und enthalten nur eigenes HTML; nichts davon kommt
 * von außen.
 */

const TEILEN = `<svg class="einf-symbol" viewBox="0 0 24 24" aria-label="Teilen-Symbol" role="img">
  <path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>`;

export function istIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function istAndroid() {
  return /Android/i.test(navigator.userAgent);
}

export function istInstalliert() {
  return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
}

/* Android bietet das Installieren über ein Ereignis an, das man sich merken
 * muss, bevor es verfällt. */
let installAngebot = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installAngebot = e;
});

function seiteHomeBildschirm() {
  const anleitung = istIOS()
    ? `<ol class="einf-schritte">
        <li>Tippe auf das Teilen-Symbol ${TEILEN}. Auf neueren iPhones steckt es hinter „•••“.</li>
        <li>Wähle <strong>„Zum Home-Bildschirm“</strong>.</li>
        <li>Tippe auf <strong>„Hinzufügen“</strong>.</li>
      </ol>`
    : `<ol class="einf-schritte">
        <li>Tippe oben rechts auf <strong>⋮</strong>.</li>
        <li>Wähle <strong>„App installieren“</strong> oder <strong>„Zum Startbildschirm hinzufügen“</strong>.</li>
      </ol>
      <p class="einf-installieren" hidden><button type="button" class="knopf-haupt" data-installieren>App installieren</button></p>`;
  return {
    bild: '📱',
    titel: 'Leg dir die App auf den Home-Bildschirm',
    html: `
      <p>Dann öffnet sie sich wie jede andere App, ohne Browserleiste.</p>
      ${anleitung}
      <p>Öffne <strong>Frag mal</strong> danach über das neue Symbol und melde dich dort an.
        So bleiben deine Gespräche sicher gespeichert. Im Browser darf Safari sie löschen,
        wenn du die Seite eine Weile nicht öffnest.</p>`,
    knopf: 'Im Browser weiter',
    danach(box) {
      const absatz = box.querySelector('.einf-installieren');
      if (!absatz || !installAngebot) return;
      absatz.hidden = false;
      absatz.querySelector('button').addEventListener('click', async () => {
        const angebot = installAngebot;
        installAngebot = null;
        absatz.hidden = true;
        await angebot.prompt();
      });
    },
  };
}

export function seitenVorAnmeldung() {
  const handy = (istIOS() || istAndroid()) && !istInstalliert();
  const seiten = [{
    bild: '👋',
    titel: 'Hallo!',
    html: `
      <p>Das hier ist <strong>Frag mal</strong>, dein eigener Zugang zu <strong>Claude</strong>,
        einem KI-Assistenten. Mit ihm kannst du schreiben wie mit einem Menschen.</p>
      <p>Frag ihn, was du wissen willst, lass dir etwas erklären, einen Text schreiben
        oder eine Idee durchdenken. Für dich kostet das nichts.</p>
      <p>Zum Anmelden brauchst du nur die E-Mail-Adresse und das Passwort, die du bekommen hast.</p>`,
    knopf: handy ? 'Weiter' : 'Zur Anmeldung',
  }];
  if (handy) seiten.push(seiteHomeBildschirm());
  return seiten;
}

export function seitenNachAnmeldung(ueberMich = '') {
  return [
    {
      bild: '💬',
      titel: 'Schön, dass du da bist!',
      html: `
        <p>Mit Claude kannst du über fast alles schreiben. Ein paar Ideen:</p>
        <ul class="einf-liste">
          <li>Was koche ich aus dem, was noch im Kühlschrank ist?</li>
          <li>Eine Nachricht formulieren, bei der dir die Worte fehlen</li>
          <li>Etwas erklärt bekommen, das du schon immer verstehen wolltest</li>
          <li>Einen Plan machen: Reise, Umzug, Training, Lernen</li>
          <li>Texte korrigieren, kürzen oder übersetzen</li>
          <li>Laut nachdenken, wenn du vor einer Entscheidung stehst</li>
        </ul>
        <p>Schreib einfach so, wie du einer Freundin schreiben würdest. Je mehr du erzählst,
          desto besser passt die Antwort.</p>`,
    },
    {
      bild: '🧭',
      titel: 'So funktioniert’s',
      html: `
        <ul class="einf-liste">
          <li>Unten schreiben und auf <strong>↑</strong> tippen. Die Antwort erscheint, während
            Claude schreibt. Mit <strong>■</strong> hältst du sie an.</li>
          <li>Innerhalb eines Gesprächs erinnert sich Claude an alles, was ihr geschrieben habt.
            Du kannst also nachfragen, „kürzer bitte“ sagen oder etwas ergänzen.</li>
          <li><strong>＋</strong> beginnt ein neues Gespräch, das bei null anfängt. Für ein neues
            Thema ist das am besten.</li>
          <li><strong>☰</strong> zeigt deine bisherigen Gespräche. Mit <strong>×</strong> daneben
            löschst du eins.</li>
        </ul>`,
    },
    {
      bild: '💡',
      titel: 'Gut zu wissen',
      html: `
        <ul class="einf-liste">
          <li><strong>Claude kann sich irren.</strong> Bei wichtigen Dingen wie Gesundheit, Geld
            oder Recht lieber noch einmal nachprüfen.</li>
          <li><strong>Kein Internet:</strong> Claude kann hier nichts nachschlagen und kennt
            keine aktuellen Nachrichten, Öffnungszeiten oder Preise.</li>
          <li><strong>Deine Gespräche</strong> liegen nur auf diesem Gerät. Für jede Antwort geht
            das Gespräch an Anthropic, die Firma hinter Claude; die App selbst speichert es
            nirgends sonst. Auf einem anderen Handy oder Computer siehst du es nicht.</li>
        </ul>`,
    },
    {
      bild: '✍️',
      titel: 'Erzähl Claude ein bisschen über dich',
      html: `
        <p>Das bekommt Claude am Anfang jedes neuen Gesprächs mit. Zum Beispiel: wie du heißt,
          was du machst, was dich interessiert und wie du Antworten am liebsten hast.</p>
        <textarea id="einf-ueber-mich" data-feld="ueberMich" rows="5" maxlength="6000"
          placeholder="Ich heiße …, arbeite als … und mag kurze, lockere Antworten."></textarea>
        <p class="klein">Das kannst du leer lassen und jederzeit unter
          „Über mich &amp; Einstellungen“ ändern.</p>`,
      werte: { ueberMich },
      knopf: 'Los geht’s',
    },
  ];
}

/*
 * Zeigt die Seiten über allem anderen an. Das Versprechen erfüllt sich, wenn
 * die Person durch ist oder überspringt, mit den eingetragenen Werten.
 */
export function zeigeEinfuehrung(wurzel, seiten) {
  return new Promise((fertig) => {
    const werte = Object.assign({}, ...seiten.map((s) => s.werte || {}));
    let nr = 0;
    const box = document.createElement('div');
    box.className = 'einf';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'einf-titel');
    wurzel.append(box);

    const merke = () => {
      for (const feld of box.querySelectorAll('[data-feld]')) werte[feld.dataset.feld] = feld.value;
    };

    const zeichne = () => {
      const s = seiten[nr];
      const letzte = nr === seiten.length - 1;
      const punkte = seiten.length > 1
        ? seiten.map((_, i) => `<span${i === nr ? ' class="an"' : ''}></span>`).join('')
        : '';
      box.innerHTML = `
        <div class="einf-in">
          <div class="einf-kopf">
            <div class="einf-punkte" aria-label="Schritt ${nr + 1} von ${seiten.length}">${punkte}</div>
            ${letzte ? '' : '<button type="button" class="link einf-weg" data-einf="ende">Überspringen</button>'}
          </div>
          <div class="einf-inhalt">
            <div class="einf-bild" aria-hidden="true">${s.bild}</div>
            <h2 id="einf-titel">${s.titel}</h2>
            ${s.html}
          </div>
          <div class="einf-fuss">
            ${nr > 0 ? '<button type="button" class="knopf-leise" data-einf="zurueck">Zurück</button>' : '<span></span>'}
            <button type="button" class="knopf-haupt" data-einf="${letzte ? 'fertig' : 'weiter'}">${s.knopf || 'Weiter'}</button>
          </div>
        </div>`;
      for (const feld of box.querySelectorAll('[data-feld]')) feld.value = werte[feld.dataset.feld] ?? '';
      s.danach?.(box);
      box.querySelector('.einf-inhalt').scrollTop = 0;
      box.querySelector('[data-einf=weiter], [data-einf=fertig]').focus({ preventScroll: true });
    };

    box.addEventListener('click', (e) => {
      const ziel = e.target.closest('[data-einf]');
      if (!ziel) return;
      const was = ziel.dataset.einf;
      merke();
      if (was === 'weiter') {
        nr++;
        zeichne();
      } else if (was === 'zurueck') {
        nr--;
        zeichne();
      } else {
        box.remove();
        fertig({ uebersprungen: was === 'ende', ...werte });
      }
    });

    zeichne();
  });
}
