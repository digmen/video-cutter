import { Bot, InputFile, InlineKeyboard, type Context } from 'grammy';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { config, isLocalApi } from './config.js';
import { cutSegment, probeDuration } from './ffmpeg.js';
import { parseCut, formatTime, segmentsFor, type CutRequest } from './parse.js';
import { cutKeyboard, describeRequest, rangeHint } from './keyboard.js';
import { enqueue, queueLength } from './queue.js';
import { activeJobsOf, createJob, gatePassed, logEvent, markGatePassed, setJobStatus, stats } from './db.js';

const bot = new Bot(config.botToken, { client: { apiRoot: config.botApiRoot } });
const isOwner = (id?: number) => id === config.ownerId;

// Один ожидающий видео-файл на пользователя: прислал видео → просим команду нарезки.
interface Pending {
  hostPath: string;
  duration: number;
  size: number;
  fileName: string;
}
const waiting = new Map<number, Pending>();

// getFile в --local режиме отдаёт путь ВНУТРИ контейнера Bot API; том смонтирован на хост.
function toHostPath(filePath: string): string {
  if (isLocalApi && filePath.startsWith(config.botapiDirContainer)) {
    return path.join(config.botapiDirHost, filePath.slice(config.botapiDirContainer.length));
  }
  return filePath;
}

async function subscribed(userId: number): Promise<'yes' | 'no' | 'unknown'> {
  if (!config.channel || isOwner(userId)) return 'yes';
  try {
    const m = await bot.api.getChatMember(config.channel, userId);
    return ['creator', 'administrator', 'member'].includes(m.status) ? 'yes' : 'no';
  } catch {
    return 'unknown';
  }
}

/** Вход: подписан на канал? Прошёл раз — не спрашиваем снова. Не проверить — пропускаем. */
async function gate(ctx: Context): Promise<boolean> {
  const from = ctx.from!;
  if (isOwner(from.id) || gatePassed(from.id)) return true;
  const st = await subscribed(from.id);
  if (st === 'no') {
    logEvent(from, 'sub_fail');
    await ctx.reply(
      `📢 Чтобы пользоваться ботом, подпишись на канал ${config.channel}.\n\nПодписался — жми «Я подписался».`,
      { reply_markup: new InlineKeyboard().url('📢 Подписаться', 'https://t.me/' + config.channel.replace(/^@/, '')).row().text('✅ Я подписался', 'subcheck') },
    );
    return false;
  }
  logEvent(from, 'sub_ok', st);
  markGatePassed(from.id);
  return true;
}

bot.command('start', async (ctx) => {
  logEvent(ctx.from!, 'start');
  if (!(await gate(ctx))) return;
  await ctx.reply(
    '🎬 Пришли видео — и я нарежу его прямо здесь.\n\n' +
      'После загрузки просто нажмёшь кнопку: по минуте, на равные части, каждые N секунд ' +
      'или вырезать один кусок.\n\n' +
      (isLocalApi ? 'Размер — до 2 ГБ, длина любая.' : '⚠️ Пока лимит 20 МБ.'),
  );
});

bot.command('stats', async (ctx) => {
  if (!isOwner(ctx.from?.id)) return;
  const s = stats();
  await ctx.reply(
    `📊 Нарезчик\nПользователей: ${s.users}\nЗадач: ${s.jobs} (готово ${s.done}, ошибок ${s.errors})\n` +
      `Кусков отдано: ${s.segments}\nВ очереди сейчас: ${queueLength()}`,
  );
});

bot.callbackQuery('subcheck', async (ctx) => {
  const st = await subscribed(ctx.from.id);
  if (st === 'no') {
    await ctx.answerCallbackQuery({ text: 'Пока не вижу подписки. Подпишись и нажми ещё раз.', show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
  markGatePassed(ctx.from.id);
  logEvent(ctx.from, 'sub_ok', st);
  await ctx.reply('Готово ✅ Пришли видео — нарежу.');
});

// ── Приём видео ───────────────────────────────────────────────────────────
bot.on(['message:video', 'message:document', 'message:video_note', 'message:animation'], async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  const from = ctx.from!;
  if (!(await gate(ctx))) return;

  const doc = ctx.message.video ?? ctx.message.document ?? ctx.message.animation ?? ctx.message.video_note;
  const mime = (ctx.message.document?.mime_type ?? ctx.message.video?.mime_type ?? '').toLowerCase();
  if (ctx.message.document && mime && !mime.startsWith('video/')) {
    await ctx.reply('Это не похоже на видео. Пришли видеофайл.');
    return;
  }

  const status = await ctx.reply('📥 Забираю файл…');
  try {
    const file = await ctx.api.getFile(doc!.file_id); // с локальным API файл уже на диске
    if (!file.file_path) throw new Error('нет пути к файлу');
    const hostPath = toHostPath(file.file_path);
    const size = statSync(hostPath).size;
    const duration = await probeDuration(hostPath);
    waiting.set(from.id, { hostPath, duration, size, fileName: ctx.message.document?.file_name ?? 'video.mp4' });
    logEvent(from, 'video_in', `${Math.round(duration)}с, ${Math.round(size / 1e6)}МБ`);
    await ctx.api.editMessageText(
      ctx.chat.id,
      status.message_id,
      `✅ Видео принято — ${formatTime(duration)}.\n\nВыбери, как нарезать 👇`,
      { reply_markup: cutKeyboard(duration) },
    );
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat.id, status.message_id, `❌ Не смог принять файл: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`).catch(() => {});
  }
});

// ── Кнопки нарезки ──────────────────────────────────────────────────────────
bot.callbackQuery(/^cut:(.+)$/, async (ctx) => {
  const p = waiting.get(ctx.from.id);
  if (!p) {
    await ctx.answerCallbackQuery({ text: 'Пришли видео заново — старое я уже убрал.', show_alert: true });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    return;
  }
  const arg = ctx.match![1];
  if (arg === 'range') {
    await ctx.answerCallbackQuery();
    await ctx.reply(rangeHint(p.duration));
    return;
  }
  let req: CutRequest;
  if (arg.startsWith('every:')) req = { kind: 'every', seconds: Number(arg.slice(6)) };
  else if (arg.startsWith('parts:')) req = { kind: 'parts', n: Number(arg.slice(6)) };
  else {
    await ctx.answerCallbackQuery();
    return;
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {}); // убираем кнопки — выбор сделан
  await launchCut(ctx, req);
});

// ── Ввод диапазона текстом (после кнопки «Вырезать кусок» или напрямую) ──────
bot.on('message:text', async (ctx) => {
  if (ctx.chat.type !== 'private') return;
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;
  const from = ctx.from!;
  const p = waiting.get(from.id);
  if (!p) {
    await ctx.reply('Сначала пришли видео 🎬');
    return;
  }
  const req = parseCut(text, p.duration);
  if ('error' in req) {
    await ctx.reply('❌ ' + req.error, { reply_markup: cutKeyboard(p.duration) });
    return;
  }
  await launchCut(ctx, req);
});

// Общий запуск нарезки: и с кнопки, и с текста. Читает ожидающее видео этого человека.
async function launchCut(ctx: Context, req: CutRequest): Promise<void> {
  const from = ctx.from!;
  const p = waiting.get(from.id);
  if (!p) {
    await ctx.reply('Сначала пришли видео 🎬');
    return;
  }
  const segs = segmentsFor(req, p.duration);
  if (segs.length === 0) {
    await ctx.reply('Ничего не получилось нарезать — попробуй другой вариант.', { reply_markup: cutKeyboard(p.duration) });
    return;
  }
  if (segs.length > 500) {
    await ctx.reply(`Это ${segs.length} кусков — слишком много. Возьми интервал побольше.`, { reply_markup: cutKeyboard(p.duration) });
    return;
  }
  // На человека — одна активная задача за раз, чтобы очередь не забивал один пользователь.
  if (!isOwner(from.id) && activeJobsOf(from.id) > 0) {
    await ctx.reply('У тебя уже есть задача в работе — дождись её, потом пришлю следующую.');
    return;
  }

  waiting.delete(from.id);
  const jobId = createJob(from, p.duration, req.kind, segs.length);
  const place = queueLength();
  const word = segs.length === 1 ? 'кусок' : segs.length < 5 ? 'куска' : 'кусков';
  await ctx.reply(
    `🧾 ${describeRequest(req)} → ${segs.length} ${word}.` +
      (place >= config.maxConcurrent ? `\n⏳ Ты в очереди, впереди: ${place}. Режу по одной, подожди.` : '\n✂️ Начинаю…'),
  );

  enqueue(async () => {
    setJobStatus(jobId, 'running');
    const outDir = path.join(config.dataDir, 'out', String(jobId));
    mkdirSync(outDir, { recursive: true });
    let sent = 0;
    try {
      for (let i = 0; i < segs.length; i++) {
        const { from: a, to: b } = segs[i];
        const out = path.join(outDir, `part_${String(i + 1).padStart(3, '0')}.mp4`);
        await cutSegment(p.hostPath, out, a, b);
        try {
          await ctx.replyWithVideo(new InputFile(out), {
            caption: `✂️ ${i + 1}/${segs.length} · ${formatTime(a)}–${formatTime(b)}`,
          });
          sent++;
        } finally {
          rmSync(out, { force: true }); // отдали — сразу удалили, диск не копим
        }
      }
      logEvent(from, 'done', `${sent}/${segs.length}`);
      setJobStatus(jobId, 'done', `${sent}/${segs.length}`);
      await ctx.reply(`✅ Готово: ${sent} ${sent === 1 ? 'кусок' : 'кусков'}. Пришли новое видео, если надо ещё.`);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
      logEvent(from, 'cut_err', msg);
      setJobStatus(jobId, 'error', msg);
      await ctx.reply(`❌ Не получилось дорезать (отдано ${sent}). ${msg}`).catch(() => {});
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(p.hostPath, { force: true }); // исходник тоже удаляем сразу
    }
  });
}

bot.catch((err) => console.error('Ошибка нарезчика:', err.error));
process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());
await bot.start({ onStart: (me) => console.log(`Нарезчик @${me.username} запущен (API: ${config.botApiRoot})`) });
