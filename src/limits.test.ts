import { describe, expect, it } from '@jest/globals';
import { cutTimeoutMs, estimateSegmentBytes, maxSegmentBytes, minPartsFor, retryAfterSeconds, uploadLimitBytes } from './limits.js';

const MB = 1024 * 1024;

describe('предел отправки', () => {
  it('свой сервер — 2000 МБ, облако — 50 МБ', () => {
    expect(uploadLimitBytes(true)).toBe(2000 * MB);
    expect(uploadLimitBytes(false)).toBe(50 * MB);
  });
});

describe('оценка размера кусков', () => {
  it('кусок весит долю от файла по длительности', () => {
    expect(estimateSegmentBytes({ from: 0, to: 50 }, 100, 1000)).toBe(500);
  });
  it('случай из жизни: 4184 МБ на 2 части — каждая больше 2 ГБ, нужно минимум 3', () => {
    const size = 4184 * MB; const dur = 89192;
    const two = [{ from: 0, to: dur / 2 }, { from: dur / 2, to: dur }];
    expect(maxSegmentBytes(two, dur, size)).toBeGreaterThan(uploadLimitBytes(true) * 0.9);
    expect(minPartsFor(size, uploadLimitBytes(true))).toBe(3);
  });
  it('маленькое видео — одна часть', () => {
    expect(minPartsFor(60 * MB, uploadLimitBytes(true))).toBe(1);
  });
});

describe('время на нарезку', () => {
  it('маленький кусок — 5–6 минут, 2 ГБ — 15 минут', () => {
    expect(cutTimeoutMs(10 * MB)).toBe(6 * 60_000);
    expect(cutTimeoutMs(2000 * MB)).toBe(15 * 60_000);
  });
});

describe('«подожди N секунд» от Telegram', () => {
  it('свой Bot API: 400 с текстом retry after', () => {
    expect(retryAfterSeconds(new Error("Call to 'sendVideo' failed! (400: Bad Request: too Many Requests: retry after 8)"))).toBe(8);
  });
  it('облако: 429 с parameters.retry_after', () => {
    expect(retryAfterSeconds({ message: 'x', description: 'Too Many Requests', parameters: { retry_after: 12 } })).toBe(12);
  });
  it('другие ошибки — не ожидание', () => {
    expect(retryAfterSeconds(new Error('400: Bad Request: FILE_PARTS_INVALID'))).toBeNull();
    expect(retryAfterSeconds(new Error('403: Forbidden: bot was blocked by the user'))).toBeNull();
  });
});
