/**
 * The feedback button in the bottom left corner, on every screen: players
 * write what went wrong or what they would change, attach screenshots, and
 * it reaches the developer (read at /reportes). The game's version, mode,
 * heroes and the browser go along automatically. At the start of every game
 * a speech bubble points at the button.
 */
import { REPORT_LIMITS, type ReportKind } from '@cardcraft-castles/protocol';
import { h, html, isTouch, toast } from '../app/dom';
import { t, type StringKey } from '../app/i18n';
import { reportContext } from '../app/reportContext';
import { modal } from '../app/router';
import { settings } from '../app/settings';
import { audio } from '../fx/audio';
import { iconSvg } from './assets';

const serverUrl = (import.meta.env.VITE_SERVER_URL as string | undefined) || '';
const ENDPOINT = `${serverUrl.replace(/\/+$/, '')}/api/reports`;

/** Screenshots are shrunk to this many pixels on the long side, then to the byte limit. */
const MAX_SIDE = 1920;
const HINT_DELAY_MS = 2200;
const HINT_MS = 9000;

interface Attachment {
  blob: Blob;
  url: string;
}

/** What the player wrote but did not send yet: it survives closing the dialog. */
const draft: { kind: ReportKind; text: string; images: Attachment[] } = { kind: 'bug', text: '', images: [] };

let button: HTMLButtonElement | null = null;
let hint: HTMLElement | null = null;
let hintTimers: number[] = [];
let hintListeners: AbortController | null = null;

/** Adds the button to the page. Call once at start-up. */
export function initFeedback(): void {
  if (button) return;
  button = h('button.btn.icon-only.feedback-btn', { type: 'button', onclick: () => openFeedback() }, html(iconSvg('feedback')));
  const label = (): void => {
    button!.setAttribute('aria-label', t('feedbackButton'));
    button!.title = t('feedbackButton');
  };
  label();
  settings.subscribe((next, prev) => {
    if (next.locale !== prev.locale) {
      label();
      hideFeedbackHint();
    }
  });
  document.body.append(button);
}

/** The speech bubble next to the button, shortly after a game starts. */
export function showFeedbackHint(): void {
  hideFeedbackHint();
  hintTimers.push(
    window.setTimeout(() => {
      if (!button?.isConnected) return;
      hint = h(
        'div.feedback-hint',
        {
          role: 'status',
          onclick: (e: Event) => {
            e.stopPropagation();
            openFeedback();
          },
        },
        t('feedbackHint'),
      );
      document.body.append(hint);
      requestAnimationFrame(() => hint?.classList.add('in'));
      // Any tap or key elsewhere puts it away; it never blocks the game.
      const listening = new AbortController();
      hintListeners = listening;
      const away = (e: Event): void => {
        if (!(e.target instanceof Node && hint?.contains(e.target))) hideFeedbackHint();
      };
      window.setTimeout(() => {
        if (listening.signal.aborted) return;
        document.addEventListener('pointerdown', away, { capture: true, signal: listening.signal });
        document.addEventListener('keydown', away, { capture: true, signal: listening.signal });
      }, 0);
      hintTimers.push(window.setTimeout(hideFeedbackHint, HINT_MS));
    }, HINT_DELAY_MS),
  );
}

export function hideFeedbackHint(): void {
  for (const timer of hintTimers) window.clearTimeout(timer);
  hintTimers = [];
  hintListeners?.abort();
  hintListeners = null;
  const old = hint;
  hint = null;
  if (!old) return;
  old.classList.remove('in');
  window.setTimeout(() => old.remove(), 300);
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall back to an <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/** A JPEG small enough to send, or null if the file is not a readable image. */
async function shrink(file: Blob): Promise<Blob | null> {
  let image: CanvasImageSource & { width: number; height: number };
  try {
    image = await decode(file);
  } catch {
    return null;
  }
  if (!image.width || !image.height) return null;
  for (const [side, quality] of [
    [MAX_SIDE, 0.85],
    [1600, 0.75],
    [1280, 0.7],
    [960, 0.65],
  ] as const) {
    const scale = Math.min(1, side / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // Transparent PNGs get the game's night colour instead of black.
    ctx.fillStyle = '#0d1020';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await encode(canvas, quality);
    if (blob && blob.size <= REPORT_LIMITS.maxImageBytes) return blob;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

const KINDS: [ReportKind, StringKey][] = [
  ['bug', 'feedbackKindBug'],
  ['idea', 'feedbackKindIdea'],
  ['other', 'feedbackKindOther'],
];

export function openFeedback(): void {
  hideFeedbackHint();
  if (document.querySelector('.modal.feedback')) return;
  audio.play('uiClick');
  modal((close) => {
    const box = h('div.modal.panel.feedback');
    const status = h('p.feedback-status', { role: 'alert' });
    const setStatus = (text: string, kind: 'error' | 'info' = 'error'): void => {
      status.textContent = text;
      status.className = `feedback-status ${kind}`;
    };

    const kinds = h('div.segmented.feedback-kinds', { role: 'group' });
    const paintKinds = (): void => {
      kinds.replaceChildren(
        ...KINDS.map(([kind, label]) =>
          h(
            'button',
            {
              type: 'button',
              'aria-pressed': String(draft.kind === kind),
              onclick: () => {
                audio.play('uiClick');
                draft.kind = kind;
                paintKinds();
              },
            },
            t(label),
          ),
        ),
      );
    };
    paintKinds();

    const text = h('textarea.feedback-text', {
      rows: 5,
      maxlength: REPORT_LIMITS.maxText,
      placeholder: t('feedbackPlaceholder'),
      'aria-label': t('feedbackPlaceholder'),
    }) as HTMLTextAreaElement;
    text.value = draft.text;
    const counter = h('span.feedback-count');
    const count = (): void => {
      counter.textContent = `${text.value.length} / ${REPORT_LIMITS.maxText}`;
    };
    text.addEventListener('input', () => {
      draft.text = text.value;
      count();
    });
    count();

    const thumbs = h('div.feedback-thumbs');
    const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true }) as HTMLInputElement;
    const attachBtn = h('button.btn.feedback-attach', { type: 'button', onclick: () => fileInput.click() }, html(iconSvg('image')), t('feedbackAttach')) as HTMLButtonElement;
    const paintThumbs = (): void => {
      thumbs.replaceChildren(
        ...draft.images.map((image, i) =>
          h(
            'div.feedback-thumb',
            null,
            h('img', { src: image.url, alt: `${i + 1}` }),
            h(
              'button.feedback-thumb-x',
              {
                type: 'button',
                'aria-label': t('feedbackRemoveImage'),
                title: t('feedbackRemoveImage'),
                onclick: () => {
                  URL.revokeObjectURL(image.url);
                  draft.images.splice(i, 1);
                  paintThumbs();
                },
              },
              html(iconSvg('close')),
            ),
          ),
        ),
      );
      attachBtn.disabled = draft.images.length >= REPORT_LIMITS.maxImages;
    };
    paintThumbs();

    const addFiles = async (files: Blob[]): Promise<void> => {
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (files.length && !images.length) return setStatus(t('feedbackBadImage'));
      setStatus('');
      for (const file of images) {
        if (draft.images.length >= REPORT_LIMITS.maxImages) {
          setStatus(t('feedbackTooMany', { n: REPORT_LIMITS.maxImages }));
          break;
        }
        const blob = await shrink(file);
        if (!blob) {
          setStatus(t('feedbackBadImage'));
          continue;
        }
        draft.images.push({ blob, url: URL.createObjectURL(blob) });
        paintThumbs();
      }
    };
    fileInput.addEventListener('change', () => {
      void addFiles([...(fileInput.files ?? [])]);
      fileInput.value = '';
    });
    // Ctrl+V with a screenshot in the clipboard, and dropping image files on the dialog.
    box.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
      }
    });
    box.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        box.classList.add('dropping');
      }
    });
    box.addEventListener('dragleave', () => box.classList.remove('dropping'));
    box.addEventListener('drop', (e) => {
      box.classList.remove('dropping');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
      }
    });

    const send = h('button.btn.primary', { type: 'button' }, t('feedbackSend')) as HTMLButtonElement;
    send.addEventListener('click', async () => {
      const message = text.value.trim();
      if (!message && !draft.images.length) {
        setStatus(t('feedbackEmpty'));
        text.focus();
        return;
      }
      const body = new FormData();
      body.set('kind', draft.kind);
      body.set('text', message);
      body.set('context', JSON.stringify(reportContext()));
      draft.images.forEach((image, i) => body.append('image', image.blob, `captura-${i + 1}.jpg`));
      send.disabled = true;
      send.textContent = t('feedbackSending');
      setStatus('');
      try {
        const res = await fetch(ENDPOINT, { method: 'POST', body });
        if (!res.ok) {
          setStatus(res.status === 429 ? t('feedbackRateLimited') : t('feedbackFailed'));
          return;
        }
        for (const image of draft.images) URL.revokeObjectURL(image.url);
        draft.text = '';
        draft.images = [];
        draft.kind = 'bug';
        close();
        audio.play('uiOpen');
        toast(t('feedbackThanks'), 'info', 3800);
      } catch {
        setStatus(t('feedbackFailed'));
      } finally {
        send.disabled = false;
        send.textContent = t('feedbackSend');
      }
    });

    box.append(
      h('h2', null, t('feedbackTitle')),
      h('p.feedback-intro', null, t('feedbackIntro')),
      kinds,
      h('div.feedback-field', null, text, counter),
      h('div.feedback-attachments', null, h('div.feedback-attach-row', null, attachBtn, h('small', null, t('feedbackAttachHint', { n: REPORT_LIMITS.maxImages }))), thumbs, fileInput),
      h('p.feedback-note', null, t('feedbackContextNote')),
      status,
      h('div.actions', null, send),
    );
    // The text box first, not the X (on phones the keyboard would cover the dialog straight away).
    if (!isTouch()) requestAnimationFrame(() => text.focus({ preventScroll: true }));
    return box;
  });
}
