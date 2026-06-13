import { cookies } from 'next/headers';
import crypto from 'crypto';

// ─── Роли ────────────────────────────────────────────────────────────────────
export type Role = 'worker' | 'manager' | 'admin';
export const ROLE_RANK: Record<Role, number> = { worker: 1, manager: 2, admin: 3 };
export const ROLE_LABEL: Record<Role, string> = {
  worker: 'Кладовщик',
  manager: 'Менеджер',
  admin: 'Админ',
};

export interface Session {
  username: string;
  name: string;
  role: Role;
}

const COOKIE = 'auth';
// Год. Плюс «скользящее» продление при каждом заходе (см. /api/auth/me) —
// фактически сессия живёт, пока пользователь сам не выйдет.
const MAX_AGE_S = 365 * 24 * 60 * 60;

function secret(): string {
  return process.env.AUTH_SECRET || process.env.CRON_SECRET || 'dev-insecure-secret-change-me';
}

// ─── Пароли (scrypt, без внешних зависимостей) ───────────────────────────────
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [saltHex, hashHex] = stored.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, salt, 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ─── Токен (HMAC-SHA256, base64url) ──────────────────────────────────────────
function b64u(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

export function signToken(payload: Session): string {
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + MAX_AGE_S * 1000 }));
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token: string): Session | null {
  try {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!data.exp || Date.now() > data.exp) return null;
    return { username: data.username, name: data.name, role: data.role };
  } catch {
    return null;
  }
}

// ─── Сессия (cookie) ─────────────────────────────────────────────────────────
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function setSessionCookie(session: Session): Promise<void> {
  (await cookies()).set(COOKIE, signToken(session), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_S,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

// ─── Проверка прав в роутах ──────────────────────────────────────────────────
export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Требует авторизацию и роль не ниже min. Бросает AuthError (401/403).
export async function requireRole(min: Role): Promise<Session> {
  const s = await getSession();
  if (!s) throw new AuthError(401, 'Не авторизован');
  if (ROLE_RANK[s.role] < ROLE_RANK[min]) throw new AuthError(403, 'Недостаточно прав');
  return s;
}

// Хелпер для роутов: оборачивает обработчик, ловит AuthError.
export async function withRole<T>(
  min: Role,
  fn: (session: Session) => Promise<T>
): Promise<T | Response> {
  try {
    const s = await requireRole(min);
    return await fn(s);
  } catch (e) {
    if (e instanceof AuthError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
