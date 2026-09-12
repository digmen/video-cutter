import { describe, expect, it } from '@jest/globals';
import { parseTime, formatTime, parseCut, segmentsFor } from './parse.js';

describe('parseTime', () => {
  it.each([
    ['90', 90],
    ['1:30', 90],
    ['01:02:03', 3723],
    ['2м', 120],
    ['90с', 90],
    ['1ч2м3с', 3723],
    ['1h30m', 5400],
    ['0', 0],
  ])('%s → %d', (input, sec) => expect(parseTime(input)).toBe(sec));

  it('мусор → null', () => {
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('')).toBeNull();
    expect(parseTime('1:99')).toBeNull();
  });
});

describe('formatTime', () => {
  it.each([
    [90, '1:30'],
    [3723, '1:02:03'],
    [5, '0:05'],
  ])('%d → %s', (sec, out) => expect(formatTime(sec)).toBe(out));
});

describe('parseCut', () => {
  const DUR = 600; // 10 минут

  it('диапазон разными способами', () => {
    expect(parseCut('от 1:30 до 2:45', DUR)).toEqual({ kind: 'range', from: 90, to: 165 });
    expect(parseCut('1:30 - 2:45', DUR)).toEqual({ kind: 'range', from: 90, to: 165 });
    expect(parseCut('90 165', DUR)).toEqual({ kind: 'range', from: 90, to: 165 });
  });
  it('конец за пределами обрезается до длины видео', () => {
    expect(parseCut('от 9:00 до 20:00', DUR)).toEqual({ kind: 'range', from: 540, to: 600 });
  });
  it('каждые N и поминутно', () => {
    expect(parseCut('каждые 60', DUR)).toEqual({ kind: 'every', seconds: 60 });
    expect(parseCut('каждые 2м', DUR)).toEqual({ kind: 'every', seconds: 120 });
    expect(parseCut('поминутно', DUR)).toEqual({ kind: 'every', seconds: 60 });
  });
  it('на N частей', () => {
    expect(parseCut('на 5 частей', DUR)).toEqual({ kind: 'parts', n: 5 });
    expect(parseCut('3 части', DUR)).toEqual({ kind: 'parts', n: 3 });
  });

  it('ошибки объясняются', () => {
    expect(parseCut('посекундно', DUR)).toHaveProperty('error');
    expect(parseCut('каждые 1', DUR)).toHaveProperty('error'); // <3с
    expect(parseCut('от 2:45 до 1:30', DUR)).toHaveProperty('error'); // конец раньше
    expect(parseCut('на 1 часть', DUR)).toHaveProperty('error');
    expect(parseCut('бла бла бла что-то', DUR)).toHaveProperty('error');
    expect(parseCut('от 20:00 до 25:00', DUR)).toHaveProperty('error'); // начало за пределами
  });
});

describe('segmentsFor', () => {
  it('range — один отрезок', () => {
    expect(segmentsFor({ kind: 'range', from: 90, to: 165 }, 600)).toEqual([{ from: 90, to: 165 }]);
  });
  it('every 60 из 200с → 4 куска, последний обрезан', () => {
    const s = segmentsFor({ kind: 'every', seconds: 60 }, 200);
    expect(s).toHaveLength(4);
    expect(s[3]).toEqual({ from: 180, to: 200 });
  });
  it('parts 4 из 200с → 4 равных', () => {
    const s = segmentsFor({ kind: 'parts', n: 4 }, 200);
    expect(s).toHaveLength(4);
    expect(s[0]).toEqual({ from: 0, to: 50 });
    expect(s[3].to).toBe(200);
  });
  it('не плодит пустой хвост', () => {
    const s = segmentsFor({ kind: 'every', seconds: 60 }, 180);
    expect(s).toHaveLength(3);
  });
});
