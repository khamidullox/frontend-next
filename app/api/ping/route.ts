export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Лёгкая проверка связи + времени сервера. Используется на странице входа, чтобы
// поймать две частые «телефонные» причины, по которым сайт не открывается у одного
// устройства: нет интернета и сбитые дата/время (ломают проверку HTTPS-сертификата).
export async function GET() {
  return Response.json({ ok: true, now: Date.now() }, {
    headers: { 'cache-control': 'no-store' },
  });
}
