import { initializeApp, getApps, cert, ServiceAccount } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

// Сервис-аккаунт читаем из переменных окружения (на Vercel — Environment Variables).
function getServiceAccount(): ServiceAccount | null {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;

  if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
    return {
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      // В переменной окружения переводы строк экранированы как \n
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }

  return null;
}

let firestore: Firestore | null = null;

export function getDb(): Firestore {
  if (firestore) return firestore;

  if (!getApps().length) {
    const serviceAccount = getServiceAccount();

    if (!serviceAccount) {
      throw new Error(
        'Firebase не настроена: задайте FIREBASE_SERVICE_ACCOUNT_JSON или FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY'
      );
    }

    initializeApp({ credential: cert(serviceAccount) });
  }

  const db = getFirestore();
  // settings() можно вызвать только один раз на инстанс Firestore.
  // При hot-reload / повторной инициализации модуля он уже задан — игнорируем.
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // already initialized — ок
  }
  firestore = db;

  return db;
}
