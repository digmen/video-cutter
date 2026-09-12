// Разбор того, что человек пишет боту: тайм-коды и запросы на нарезку. Чистые функции — под тесты.

/** «90», «1:30», «01:02:03», «2м», «90с», «1ч2м», «1.5» (мин? нет — секунды с точкой) → секунды. null — не разобрать. */
export function parseTime(input: string): number | null {
  const t = input.trim().toLowerCase().replace(',', '.');
  if (!t) return null;

  // 12:34:56 или 12:34
  if (/^\d{1,3}(:\d{1,2}){1,2}$/.test(t)) {
    const parts = t.split(':').map(Number);
    if (parts.some((p) => Number.isNaN(p))) return null;
    const [a, b, c] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
    if (b > 59 || c > 59) return null;
    return a * 3600 + b * 60 + c;
  }

  // 1ч2м3с / 2м / 90с / 1h30m
  const ru = t.match(/^(?:(\d+(?:\.\d+)?)\s*(?:ч|h))?\s*(?:(\d+(?:\.\d+)?)\s*(?:м|m))?\s*(?:(\d+(?:\.\d+)?)\s*(?:с|s))?$/);
  if (ru && (ru[1] || ru[2] || ru[3])) {
    return (Number(ru[1] ?? 0) * 3600) + (Number(ru[2] ?? 0) * 60) + Number(ru[3] ?? 0);
  }

  // голое число = секунды
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

export type CutRequest =
  | { kind: 'range'; from: number; to: number }
  | { kind: 'every'; seconds: number }
  | { kind: 'parts'; n: number };

/**
 * Разбирает команду нарезки. Понимает:
 *   «от 1:30 до 2:45», «1:30 - 2:45», «1:30 2:45»  → range
 *   «каждые 60», «каждые 2м», «поминутно»            → every
 *   «на 5 частей», «5 частей»                        → parts
 * duration — общая длина видео (для проверки границ). Возвращает запрос или текст ошибки.
 */
export function parseCut(input: string, duration: number): CutRequest | { error: string } {
  const t = input.trim().toLowerCase();

  if (/поминутн/.test(t)) return { kind: 'every', seconds: 60 };
  if (/посекундн/.test(t)) return { error: 'Посекундно — это тысячи кусков, так не режем. Скажи «каждые N секунд» (например, каждые 30).' };

  const parts = t.match(/(?:на\s+)?(\d+)\s*част/);
  if (parts) {
    const n = Number(parts[1]);
    if (n < 2 || n > 500) return { error: 'Частей — от 2 до 500.' };
    return { kind: 'parts', n };
  }

  const every = t.match(/кажд\S*\s+(.+)/);
  if (every) {
    const sec = parseTime(every[1]);
    if (sec === null || sec <= 0) return { error: 'Не понял интервал. Например: «каждые 60» или «каждые 2м».' };
    if (sec < 3) return { error: 'Слишком мелко — минимум 3 секунды на кусок.' };
    return { kind: 'every', seconds: sec };
  }

  // диапазон: «от X до Y», «X - Y», «X Y»
  const range =
    t.match(/от\s+(\S+)\s+до\s+(\S+)/) ||
    t.match(/(\S+)\s*[-–—]\s*(\S+)/) ||
    t.match(/^(\S+)\s+(\S+)$/);
  if (range) {
    const from = parseTime(range[1]);
    const to = parseTime(range[2]);
    if (from === null || to === null) return { error: 'Не понял тайм-коды. Например: «от 1:30 до 2:45».' };
    if (to <= from) return { error: 'Конец должен быть позже начала.' };
    if (duration && from >= duration) return { error: `Начало (${formatTime(from)}) за пределами видео (${formatTime(duration)}).` };
    return { kind: 'range', from, to: duration ? Math.min(to, duration) : to };
  }

  return { error: 'Не понял. Примеры:\n• от 1:30 до 2:45\n• каждые 60\n• поминутно\n• на 5 частей' };
}

/** Раскладывает запрос в конкретные отрезки [start, end] в секундах. */
export function segmentsFor(req: CutRequest, duration: number): { from: number; to: number }[] {
  if (req.kind === 'range') return [{ from: req.from, to: req.to }];
  const step = req.kind === 'every' ? req.seconds : duration / req.n;
  const out: { from: number; to: number }[] = [];
  for (let s = 0; s < duration - 0.5; s += step) out.push({ from: s, to: Math.min(s + step, duration) });
  return out;
}
