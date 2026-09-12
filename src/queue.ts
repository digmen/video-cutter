import { config } from './config.js';

// Очередь задач: защита сервера, на котором рядом живут боевые VPN-боты. Одновременно
// выполняется не больше MAX_CONCURRENT (по умолчанию 1). Остальные ждут. Пользователей не
// ограничиваем и не блокируем — их слова: «пусть хоть 10 человек, просто медленно».

type Task = () => Promise<void>;
interface Item {
  task: Task;
  onQueued?: (place: number) => void;
}

const pending: Item[] = [];
let running = 0;

export function queueLength(): number {
  return pending.length + running;
}

export function enqueue(task: Task, onQueued?: (place: number) => void): void {
  pending.push({ task, onQueued });
  const place = pending.length + running; // грубое место в очереди
  if (place > config.maxConcurrent && onQueued) onQueued(place - config.maxConcurrent);
  pump();
}

function pump(): void {
  while (running < config.maxConcurrent && pending.length > 0) {
    const item = pending.shift()!;
    running++;
    void item
      .task()
      .catch(() => {})
      .finally(() => {
        running--;
        pump();
      });
  }
}
