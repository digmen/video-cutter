// Пределы Telegram для отправки и расчёты под них. Чистые функции — проверяются тестами.

const MB = 1024 * 1024;

/** Сколько бот может отправить одним файлом: свой сервер Bot API — 2000 МБ, облачный — 50 МБ. */
export function uploadLimitBytes(localApi: boolean): number {
  return (localApi ? 2000 : 50) * MB;
}

/**
 * Оценка заранее: кусок весит примерно столько же, какую долю длительности он занимает.
 * Битрейт по видео неровный, поэтому сравниваем с запасом 10% от предела.
 * 🔴 Без этой проверки 4-гигабайтное видео резали на 2 части по ~2 ГБ, полчаса резали,
 * а Telegram отвечал FILE_PARTS_INVALID (6 упавших задач с 24.10 по 30.10.2026).
 */
export function estimateSegmentBytes(seg: { from: number; to: number }, duration: number, size: number): number {
  if (duration <= 0) return size;
  return (size * Math.max(0, seg.to - seg.from)) / duration;
}

export const SAFE_SHARE = 0.9;

/** Самый тяжёлый кусок по оценке. */
export function maxSegmentBytes(segs: { from: number; to: number }[], duration: number, size: number): number {
  return segs.reduce((m, s) => Math.max(m, estimateSegmentBytes(s, duration, size)), 0);
}

/** Сколько частей нужно минимум, чтобы каждая влезла в предел (с запасом). */
export function minPartsFor(size: number, limit: number): number {
  return Math.max(1, Math.ceil(size / (limit * SAFE_SHARE)));
}

/**
 * Время на нарезку одного куска: 5 минут + минута на каждые 200 МБ.
 * Резка идёт с ionice «idle» (чтобы не мешать VPN-ботам), и на занятом диске 2-гигабайтный
 * кусок не успевал за прежние фиксированные 5 минут (задача 167, 24.10.2026).
 */
export function cutTimeoutMs(segmentBytes: number): number {
  return 5 * 60_000 + Math.ceil(segmentBytes / (200 * MB)) * 60_000;
}

/**
 * «Подожди N секунд» от Telegram. Свой сервер Bot API присылает его как 400
 * «Bad Request: too Many Requests: retry after 8», а не как 429, поэтому смотрим на текст,
 * а не на код (12 упавших задач с 26.10 по 03.11.2026 — бот сдавался вместо ожидания).
 */
export function retryAfterSeconds(e: unknown): number | null {
  const msg = e instanceof Error ? e.message : String(e);
  const desc = (e as { description?: string })?.description ?? '';
  const params = (e as { parameters?: { retry_after?: number } })?.parameters;
  if (params?.retry_after && params.retry_after > 0) return params.retry_after;
  const m = /retry after (\d+)/i.exec(`${desc} ${msg}`);
  return m ? Number(m[1]) : null;
}
