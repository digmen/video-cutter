import { describe, expect, it } from '@jest/globals';
import { sanitize, isBlockedByUser, userMessage } from './safe.js';

describe('sanitize', () => {
  it('вырезает токен бота и путь из ошибки ffmpeg', () => {
    const raw =
      'Error opening input file /root/video-cutter/botapi/1234567:FAKE-test-token-not-real-0123456789/videos/file_40.mp4.';
    const out = sanitize(raw);
    expect(out).not.toMatch(/FAKE-test-token/);
    expect(out).toContain("<path>");
    expect(out).not.toMatch(/\/root\//);
  });
  it('не трогает обычный текст', () => {
    expect(sanitize('ffmpeg вышел с кодом 234')).toBe('ffmpeg вышел с кодом 234');
  });
});

describe('isBlockedByUser', () => {
  it('узнаёт блокировку бота', () => {
    expect(isBlockedByUser(new Error("Call to 'sendVideo' failed! (403: Forbidden: bot was blocked by the user)"))).toBe(true);
  });
  it('другие ошибки — нет', () => {
    expect(isBlockedByUser(new Error('ffmpeg вышел с кодом 234'))).toBe(false);
  });
});

describe('userMessage', () => {
  it('человеческий текст без путей и кодов', () => {
    for (const r of ['input_missing', 'unsupported_format', 'timeout', 'unknown'] as const) {
      expect(userMessage(r)).not.toMatch(/ffmpeg|\/root|код \d/i);
    }
  });
});
