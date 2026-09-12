import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Нет переменной ${name} — скопируй .env.example → .env и заполни.`);
  return v;
}

export const config = {
  botToken: required('BOT_TOKEN'),
  // Локальный Bot API (docker): поднимает лимит приёма/отдачи до 2 ГБ и кладёт файлы на диск.
  botApiRoot: process.env.BOT_API_ROOT?.trim() || 'https://api.telegram.org',
  // getFile в --local режиме отдаёт путь ВНУТРИ контейнера Bot API; том смонтирован на хост,
  // поэтому путь переводим: <container-prefix> → <host-prefix>.
  botapiDirContainer: process.env.BOTAPI_DIR_CONTAINER?.trim() || '/var/lib/telegram-bot-api',
  botapiDirHost: process.env.BOTAPI_DIR_HOST?.trim() || '/root/video-cutter/botapi',
  dataDir: process.env.DATA_DIR?.trim() || '/root/video-cutter/data',
  dbPath: process.env.DB_PATH?.trim() || '/root/video-cutter/data/cutter.db',
  ownerId: Number(process.env.OWNER_ID ?? '0'),
  channel: process.env.CHANNEL?.trim() || '',
  maxConcurrent: Math.max(1, Number(process.env.MAX_CONCURRENT ?? '1')),
};

/** Локальный Bot API — большие файлы и локальные пути. Иначе публичный (лимит 20/50 МБ). */
export const isLocalApi = config.botApiRoot !== 'https://api.telegram.org';
