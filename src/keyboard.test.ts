import { describe, expect, it } from '@jest/globals';
import { cutKeyboard, describeRequest, rangeHint } from './keyboard.js';

const datas = (kb: ReturnType<typeof cutKeyboard>) =>
  kb.inline_keyboard.flat().map((b) => ('callback_data' in b ? b.callback_data : '')).filter(Boolean);

describe('cutKeyboard подстраивается под длину', () => {
  it('короткое видео (34с) — без огромных интервалов и без «на 10»', () => {
    const d = datas(cutKeyboard(34));
    expect(d).toContain('cut:every:30');
    expect(d).not.toContain('cut:every:300'); // 5 мин в 34с бессмысленно
    expect(d).not.toContain('cut:parts:10'); // куски были бы <3с
    expect(d).toContain('cut:range');
  });

  it('часовое видео — есть крупные интервалы и все деления', () => {
    const d = datas(cutKeyboard(3600));
    expect(d).toContain('cut:every:60');
    expect(d).toContain('cut:parts:10');
    expect(d).toContain('cut:range');
  });

  it('всегда есть «вырезать кусок»', () => {
    expect(datas(cutKeyboard(5))).toContain('cut:range');
  });
});

describe('тексты', () => {
  it('rangeHint даёт пример под длину видео', () => {
    expect(rangeHint(600)).toContain('до');
    expect(rangeHint(600)).toContain('10:00'); // длина
  });
  it('describeRequest по-человечески', () => {
    expect(describeRequest({ kind: 'range', from: 90, to: 165 })).toContain('1:30');
    expect(describeRequest({ kind: 'every', seconds: 60 })).toContain('1 мин');
    expect(describeRequest({ kind: 'parts', n: 5 })).toContain('5');
  });
});
