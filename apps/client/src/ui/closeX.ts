import { h, html } from '../app/dom';
import { t } from '../app/i18n';
import { audio } from '../fx/audio';
import { iconSvg } from './assets';

/**
 * The red X in the top right corner of a dialog's content. `onCard` puts it
 * on the corner of a card (half outside); otherwise it sits inside a panel.
 */
export function closeX(onClose: () => void, onCard = false): HTMLButtonElement {
  return h(
    'button.close-x',
    {
      type: 'button',
      class: onCard ? 'on-card' : '',
      'aria-label': t('close'),
      title: t('close'),
      onclick: (e: Event) => {
        e.stopPropagation();
        audio.play('uiBack');
        onClose();
      },
    },
    html(iconSvg('close')),
  );
}
