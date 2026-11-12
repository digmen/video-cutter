// Тексты ошибок идут в журнал и (раньше) пользователю. Путь к файлу локального Bot API содержит
// ТОКЕН БОТА (<dir>/<token>/videos/file_N.mp4), поэтому сырую ошибку наружу не отдаём никогда:
// сначала через sanitize(), пользователю — только человеческий текст из userMessage().

const TOKEN_RE = /\d{6,}:[A-Za-z0-9_-]{25,}/g;
const ABS_PATH_RE = /\/(?:root|var|tmp|home|opt|usr)\/[^\s'"]*/g;

/** Убирает токены и абсолютные пути из текста ошибки. */
export function sanitize(text: string): string {
  return text.replace(TOKEN_RE, '<token>').replace(ABS_PATH_RE, '<path>');
}

/** Причины сбоя нарезки, которые мы умеем объяснить человеку. */
export type CutFailure = 'input_missing' | 'unsupported_format' | 'timeout' | 'too_big' | 'unknown';

export class CutError extends Error {
  constructor(
    public readonly reason: CutFailure,
    detail: string,
  ) {
    super(sanitize(detail));
    this.name = 'CutError';
  }
}

/** Пользователю — только это, без ffmpeg и путей. */
export function userMessage(reason: CutFailure): string {
  switch (reason) {
    case 'input_missing':
      return 'Файл с сервера пропал (так бывает, если видео прислали дважды подряд). Пришли видео заново.';
    case 'unsupported_format':
      return 'Не смог разрезать это видео: необычный формат внутри файла. Попробуй прислать его как обычный mp4.';
    case 'timeout':
      return 'Нарезка заняла слишком много времени. Попробуй куски покрупнее.';
    case 'too_big':
      return 'Кусок вышел больше 2 ГБ — Telegram такой не пропускает. Нарежь на больше частей.';
    default:
      return 'Что-то пошло не так при нарезке. Автор уже получил сообщение об ошибке.';
  }
}

/** Бот заблокирован пользователем: отправлять больше некому, это не сбой бота. */
export function isBlockedByUser(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /bot was blocked by the user|user is deactivated|chat not found/i.test(msg);
}
