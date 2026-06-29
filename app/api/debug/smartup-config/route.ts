import { withRole } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Временный: показывает админу НЕсекретные параметры подключения Smartup
// (filial_id и project) — чтобы восстановить значение write-only env-переменной
// на Vercel. Логин/пароль НЕ отдаём. Удалить после использования.
export async function GET() {
  return withRole('admin', async () => Response.json({
    project: process.env.SMARTUP_PROJECT || 'anor',
    filial_id: process.env.SMARTUP_FILIAL_ID || '(не задан)',
    url: process.env.SMARTUP_URL || 'https://smartup.online',
  }));
}
