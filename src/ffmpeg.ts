import { spawn } from 'node:child_process';

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
  const { code, stderr } = await run(
    'ffmpeg',
    ['-y', '-ss', String(from), '-i', input, '-t', String(duration), '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-map', '0', output],
    timeoutMs,
  );
  if (code !== 0) throw new Error('ffmpeg вышел с кодом ' + code + ': ' + stderr.split('\n').filter(Boolean).slice(-2).join(' '));
}
