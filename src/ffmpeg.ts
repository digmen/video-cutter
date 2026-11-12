import { spawn } from 'node:child_process';
import { CutError } from './safe.js';

// Обёртки над ffmpeg/ffprobe. Нарезка идёт БЕЗ перекодирования (-c copy): почти не грузит
// сервер (важно — рядом живут боевые VPN-боты) и режется за секунды даже для 4-часового видео.
// Точность границ — до ближайшего ключевого кадра (доли секунды).

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    // nice/ionice — низкий приоритет CPU и диска, чтобы нарезка не мешала VPN-ботам.
    const child = spawn('nice', ['-n', '15', 'ionice', '-c', '3', cmd, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('ffmpeg не уложился по времени'));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

export async function probeDuration(file: string): Promise<number> {
  const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d.toString()));
  await new Promise<void>((res) => child.on('close', () => res()));
  const dur = parseFloat(out.trim());
  if (!Number.isFinite(dur) || dur <= 0) throw new Error('не удалось определить длительность файла');
  return dur;
}

/**
 * Вырезает [from, to] без перекодирования. -ss ПЕРЕД -i = быстрый поиск по ключевым кадрам.
 * 🔴 При -ss перед -i параметр -to трактуется как ДЛИТЕЛЬНОСТЬ от точки поиска, а не как
 * абсолютное время (куски налезали друг на друга — поймано смоук-тестом 13.09). Поэтому
 * задаём длительность через -t = to - from. -avoid_negative_ts чинит рассинхрон на не-ключевом кадре.
 */
export async function cutSegment(input: string, output: string, from: number, to: number, timeoutMs = 5 * 60_000): Promise<void> {
  const duration = Math.max(0.1, to - from);
  // 🔴 Раньше стояло `-map 0` (все потоки подряд). У видео с телефонов/камер бывают служебные потоки
  // (таймкод tmcd, телеметрия — «data»), которых нет в mp4: ffmpeg падал с кодом 234
  // «Could not find tag for codec none … Invalid argument» (воспроизведено 21.10.2026). Берём только
  // видео и звук, субтитры и data-потоки отбрасываем.
  const base = ['-y', '-ss', String(from), '-i', input, '-t', String(duration), '-avoid_negative_ts', 'make_zero', '-map', '0:v', '-map', '0:a?', '-sn', '-dn'];
  // Попытка 1: всё без перекодирования. Попытка 2: видео как есть, звук в aac (если звук в формате,
  // которого нет в mp4: pcm, dts и т.п.). Дальше не идём — полное перекодирование слишком тяжело для сервера.
  const attempts: string[][] = [
    [...base, '-c', 'copy', output],
    [...base, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', output],
  ];
  let last = '';
  for (const args of attempts) {
    let res: { code: number; stderr: string };
    try {
      res = await run('ffmpeg', args, timeoutMs);
    } catch (e) {
      throw new CutError(String(e instanceof Error ? e.message : e).includes('время') ? 'timeout' : 'unknown', String(e));
    }
    if (res.code === 0) return;
    last = res.stderr.split('\n').filter(Boolean).slice(-6).join(' | ');
    if (/No such file or directory|does not exist/i.test(res.stderr) && /Error opening input/i.test(res.stderr)) {
      throw new CutError('input_missing', 'ffmpeg ' + res.code + ': ' + last);
    }
  }
  throw new CutError('unsupported_format', 'ffmpeg не смог нарезать ни одним способом: ' + last);
}
