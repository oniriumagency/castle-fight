import { h } from '../app/dom';
import { t } from '../app/i18n';
import { modal } from '../app/router';
import { MUSIC_FILES } from '../fx/sound/music';

interface MusicCredit {
  /** The file in `public/music/`, so a piece the game stops using drops out of the list. */
  file: string;
  title: string;
  author: string;
  source: { label: string; url: string };
  license: { label: string; url: string };
}

const CC_BY_4 = { label: 'Creative Commons: By Attribution 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' };
const CC0 = { label: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' };
const INCOMPETECH = { label: 'incompetech.com', url: 'https://incompetech.com' };

/**
 * The attribution the music licenses ask for. Kevin MacLeod's pieces are
 * CC BY 4.0, which requires this credit; Juhani Junkala's is CC0 and is
 * credited as a courtesy.
 */
export const MUSIC_CREDITS: readonly MusicCredit[] = [
  { file: 'village-consort.mp3', title: 'Village Consort', author: 'Kevin MacLeod', source: INCOMPETECH, license: CC_BY_4 },
  { file: 'folk-round.mp3', title: 'Folk Round', author: 'Kevin MacLeod', source: INCOMPETECH, license: CC_BY_4 },
  { file: 'lord-of-the-land.mp3', title: 'Lord of the Land', author: 'Kevin MacLeod', source: INCOMPETECH, license: CC_BY_4 },
  { file: 'pippin-the-hunchback.mp3', title: 'Pippin the Hunchback', author: 'Kevin MacLeod', source: INCOMPETECH, license: CC_BY_4 },
  { file: 'heavy-interlude.mp3', title: 'Heavy Interlude', author: 'Kevin MacLeod', source: INCOMPETECH, license: CC_BY_4 },
  { file: 'burnt-spirit.mp3', title: 'Burnt Spirit', author: 'Kevin MacLeod', source: INCOMPETECH, license: CC_BY_4 },
  {
    file: 'epic-boss-battle.mp3',
    title: 'Epic Boss Battle',
    author: 'Juhani Junkala (SubspaceAudio)',
    source: { label: 'OpenGameArt.org', url: 'https://opengameart.org/content/boss-battle-music' },
    license: CC0,
  },
];

const link = (l: { label: string; url: string }): HTMLElement => h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.label);

/** Credits dialog, opened from the settings. */
export function openCredits(): void {
  modal(() =>
    h(
      'div.modal.panel.credits',
      null,
      h('h2', null, t('credits')),
      h('p.credits-lead', null, t('creditsGame')),
      h('h3', null, t('creditsMusic')),
      h(
        'ul.credits-list',
        null,
        MUSIC_CREDITS.filter((c) => MUSIC_FILES.includes(c.file)).map((c) =>
          h(
            'li',
            null,
            h('strong', null, `"${c.title}"`),
            ` ${c.author} (`,
            link(c.source),
            ')',
            h('br'),
            h('small', null, 'Licensed under ', link(c.license)),
          ),
        ),
      ),
    ),
  );
}
