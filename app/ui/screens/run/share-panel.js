// Share panel for a finished run / daily: the share text (emoji row) with Copy, the share card
// image (thumbnail + Share/Download) and the "Challenge a friend" link.
//   <SharePanel text=${…} card=${shareCard} link=${url} filename="…png" title="…" />
import { useEffect, useRef, useState } from 'preact/hooks';
import { html, cx } from '../../lib/html.js';
import { Button } from '../../components/button.js';
import { Icon } from '../../components/icon.js';
import { toast } from '../../components/toast.js';
import { renderShareImage, shareImage } from '../../lib/share-image.js';

/** Copy text to the clipboard (Clipboard API, else a hidden textarea). */
export async function copyText(text) {
  try {
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function SharePanel({
  text,
  card,
  link,
  filename = 'world-cup-draft.png',
  heading = 'Share your run',
  title,
  class: className,
}) {
  const [blob, setBlob] = useState(null);
  const [thumb, setThumb] = useState(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(null);

  // Draw the card once the screen settles, so the thumbnail shows what will be shared.
  useEffect(() => {
    if (!card) return undefined;
    let live = true,
      url = null;
    const idle = globalThis.requestIdleCallback || (fn => setTimeout(fn, 200));
    idle(() => {
      pending.current = renderShareImage(card)
        .then(b => {
          if (!live) return b;
          url = URL.createObjectURL(b);
          setBlob(b);
          setThumb(url);
          return b;
        })
        .catch(error => {
          console.warn('[share] image failed', error);
          return null;
        });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [card]);

  const copy = async (value, what) => {
    const ok = await copyText(value);
    toast(
      ok
        ? { title: `${what} copied`, tone: 'success', duration: 2500 }
        : { title: `Could not copy the ${what.toLowerCase()}`, tone: 'warning' },
    );
  };
  const onImage = async () => {
    setBusy(true);
    try {
      const b = blob || (await (pending.current || renderShareImage(card)));
      if (!b) throw Error('no image');
      const how = await shareImage(b, { filename, title, text });
      if (how === 'downloaded') toast({ title: 'Image saved', tone: 'success', duration: 2500 });
    } catch {
      toast({ title: 'Could not create the image', tone: 'warning' });
    } finally {
      setBusy(false);
    }
  };
  const onChallenge = async () => {
    const nav = globalThis.navigator;
    if (nav?.share && globalThis.matchMedia?.('(pointer: coarse)').matches) {
      try {
        await nav.share({ title: title || 'World Cup Draft', text: 'Beat my run:', url: link });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    copy(link, 'Challenge link');
  };

  return html`<section
    class=${cx('share-panel card card--gold card--pad-md', className)}
    aria-labelledby="share-title"
  >
    <div class="share-panel__head">
      <p class="eyebrow is-gold">Brag</p>
      <h2 class="share-panel__title" id="share-title">${heading}</h2>
    </div>
    <div class="share-panel__body">
      <figure class="share-panel__thumb" aria-hidden=${thumb ? undefined : 'true'}>
        ${
          thumb
            ? html`<img src=${thumb} alt="Share card preview" width="216" height="270" />`
            : html`<span class="share-panel__thumb-wait"
                ><${Icon} name="sparkles" size=${20}
              /></span>`
        }
      </figure>
      <div class="share-panel__text">
        <pre class="share-text" data-testid="share-text">${text}</pre>
        <div class="share-panel__actions">
          <${Button} icon="copy" onClick=${() => copy(text, 'Result')} data-testid="copy-share"
            >Copy result<//
          >
          <${Button}
            icon=${globalThis.navigator?.canShare ? 'share-2' : 'download'}
            onClick=${onImage}
            loading=${busy}
            disabled=${!card}
            data-testid="share-image"
            >${globalThis.navigator?.canShare ? 'Share image' : 'Save image'}<//
          >
          ${
            link &&
            html`<${Button}
              icon="swords"
              variant="ghost"
              onClick=${onChallenge}
              data-testid="challenge-link"
              >Challenge a friend<//
            >`
          }
        </div>
      </div>
    </div>
  </section>`;
}
