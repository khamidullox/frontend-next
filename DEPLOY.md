# Развёртывание (Vercel + Firestore) — бесплатно

Бэкенд теперь встроен в Next.js (папка `app/api`). Отдельный сервер не нужен.
Состояние (сессии проверки + справочник товаров) хранится в **Firestore**.

---

## 1. Firebase / Firestore (один раз)

1. Зайдите на https://console.firebase.google.com → **Add project**.
2. В проекте откройте **Build → Firestore Database → Create database**
   (режим **Production**, регион — ближайший, напр. `eur3`).
3. Откройте **Project Settings (⚙) → Service accounts → Generate new private key**.
   Скачается JSON-файл — это ключ доступа.
4. Превратите содержимое JSON в **одну строку** и вставьте в переменную
   `FIREBASE_SERVICE_ACCOUNT_JSON` (см. ниже).

> План **Spark (бесплатный)** даёт 50k чтений / 20k записей / день — складу хватает с запасом.

---

## 2. Локальный запуск

1. Скопируйте `.env.example` → `.env.local` и заполните:
   - `SMARTUP_PASSWORD` — пароль Smartup
   - `FIREBASE_SERVICE_ACCOUNT_JSON` — JSON ключа одной строкой
2. Установите зависимости и запустите:
   ```
   npm install
   npm run dev
   ```
3. Первичная заливка справочника (11k товаров, разово):
   ```
   curl -X POST "http://localhost:3000/api/sync/products?full=true&secret=local-dev-secret"
   ```
   Дальше синк только обновлений (см. п.4).
4. Откройте http://localhost:3000 и проверьте накладную по ID.

---

## 3. Деплой на Vercel

1. Залейте проект в GitHub.
2. На https://vercel.com → **Add New → Project** → выберите репозиторий
   (Root Directory: `frontend-next`).
3. В **Settings → Environment Variables** добавьте всё из `.env.example`:
   - `SMARTUP_URL`, `SMARTUP_USERNAME`, `SMARTUP_PASSWORD`, `SMARTUP_PROJECT`
   - `FIREBASE_SERVICE_ACCOUNT_JSON`
   - `CRON_SECRET` — придумайте случайную строку
4. **Deploy**.
5. После деплоя — первичная заливка справочника (разово):
   ```
   curl -X POST "https://<ваш-проект>.vercel.app/api/sync/products?full=true&secret=<CRON_SECRET>"
   ```

---

## 4. Автообновление справочника (cron)

`vercel.json` уже настроен — каждый день в 02:00 UTC Vercel вызывает
`/api/sync/products` (инкрементально: только изменённые товары, ~десятки записей).
Vercel сам подставляет `CRON_SECRET` в заголовок авторизации.

Новые товары, созданные в Smartup, подхватываются автоматически.

---

## Архитектура

```
Vercel (бесплатно)
├── Фронтенд (страницы)
└── API-роуты (app/api) ── Smartup API
                        └─ Firestore (сессии + товары)
```
