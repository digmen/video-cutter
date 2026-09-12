import { InlineKeyboard } from 'grammy';
import { formatTime, type CutRequest } from './parse.js';

// Кнопки нарезки под конкретное видео: показываем только то, что имеет смысл для его длины,
// чтобы не пугать человека (его правки 13.09: типизм не юзабелен, нужны кнопки).

const EVERY = [30, 60, 120, 300, 600]; // сек
const PARTS = [2, 3, 5, 10];
const label = (s: number) => (s % 60 === 0 ? `${s / 60} мин` : `${s} сек`);

export function cutKeyboard(duration: number): InlineKeyboard {
  const kb = new InlineKeyboard();

  // «Каждые N» — только интервалы меньше видео (иначе один кусок = всё видео).
  const every = EVERY.filter((s) => s < duration - 1).slice(0, 3);
  if (every.length) {
    for (const s of every) kb.text(`✂️ Каждые ${label(s)}`, `cut:every:${s}`);
    kb.row();
  }

  // «На N частей» — так, чтобы кусок был не короче 5 сек (мельче — кнопка бессмысленна).
  const parts = PARTS.filter((n) => duration / n >= 5);
  if (parts.length) {
    for (const n of parts) kb.text(`🔢 На ${n}`, `cut:parts:${n}`);
    kb.row();
  }

  kb.text('🎯 Вырезать кусок', 'cut:range');
  return kb;
}

/** Текст подсказки для «вырезать кусок» — с примером под реальную длину видео. */
export function rangeHint(duration: number): string {
  const a = Math.floor(duration * 0.25);
  const b = Math.floor(duration * 0.6);
  return (
    '🎯 Напиши, какой кусок вырезать, в формате «от НАЧАЛО до КОНЕЦ».\n\n' +
    `Например: от ${formatTime(a)} до ${formatTime(b)}\n` +
    `Видео длиной ${formatTime(duration)}. Время можно писать как 1:30, 90, или 1м30с.`
  );
}

/** Понятное описание того, что выбрали — для подтверждения. */
export function describeRequest(req: CutRequest): string {
  if (req.kind === 'range') return `вырезать кусок ${formatTime(req.from)}–${formatTime(req.to)}`;
  if (req.kind === 'every') return `резать каждые ${label(req.seconds)}`;
  return `разбить на ${req.n} равных частей`;
}
