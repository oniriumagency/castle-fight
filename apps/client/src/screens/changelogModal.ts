import { h, html } from '../app/dom';
import { L, t } from '../app/i18n';
import { modal } from '../app/router';
import { audio } from '../fx/audio';
import { CHANGELOG, markChangelogSeen, type ChangelogCard, type ChangelogRelease, type ChangelogSection } from '../game/changelog';
import { iconSvg } from '../ui/assets';
import { cardFace, heroCard } from '../ui/card';

function changedCard(entry: ChangelogCard): HTMLElement {
  const card = entry.hero ? heroCard(entry.id, { calm: true, lazy: true }) : cardFace(entry.id, { calm: true, lazy: true });
  return h('figure.cl-card', { class: entry.hero ? 'is-hero' : '' }, card, h('figcaption', null, L(entry.note)));
}

function section(s: ChangelogSection): HTMLElement {
  return h(
    'section.cl-section',
    null,
    h('h3', null, h('span.cl-icon', null, html(iconSvg(s.icon))), L(s.title)),
    s.body ? h('p.cl-body', null, html(L(s.body))) : null,
    s.cards ? h('div.cl-cards', { class: s.cards.length <= 2 ? 'few' : '' }, s.cards.map(changedCard)) : null,
    s.points
      ? h(
          'ul.cl-points',
          null,
          s.points.map((p) => h('li', null, h('span.cl-icon', null, html(iconSvg(p.icon))), h('span', null, L(p.text)))),
        )
      : null,
  );
}

function release(r: ChangelogRelease, newest: boolean): HTMLElement {
  return h(
    'article.cl-release',
    null,
    h(
      'header.cl-head',
      null,
      h('span.cl-eyebrow', null, newest ? t('whatsNew') : L(r.date)),
      h('h2', null, L(r.title)),
      newest ? h('p.cl-date', null, L(r.date)) : null,
      h('p.cl-lead', null, L(r.lead)),
    ),
    r.sections.map(section),
  );
}

/** The player-facing list of changes, newest update first. Opening it counts as seen. */
export function openChangelog(): void {
  markChangelogSeen();
  modal((close) =>
    h(
      'div.modal.panel.changelog',
      null,
      CHANGELOG.map((r, i) => release(r, i === 0)),
      h(
        'div.actions',
        null,
        h(
          'button.btn.primary.big',
          {
            type: 'button',
            onclick: () => {
              audio.play('uiClick');
              close();
            },
          },
          t('whatsNewPlay'),
        ),
      ),
    ),
  );
}
