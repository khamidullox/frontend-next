# Запуск проекта на другом компьютере

Код хранится на GitHub. На новый компьютер переносится через `git clone`.
**Важно:** секреты (`.env.local`) НЕ лежат в репозитории — их нужно перенести отдельно.

## 1. Установить программы
- **Node.js** (LTS, версия 20+): https://nodejs.org
- **Git**: https://git-scm.com
- (по желанию) **VS Code** для редактирования: https://code.visualstudio.com

## 2. Скачать код
```bash
git clone https://github.com/khamidullox/frontend-next.git
cd frontend-next
npm install
```

## 3. Перенести секреты — файл `.env.local`
Создай в папке `frontend-next` файл `.env.local` со значениями (скопируй
его с рабочего компьютера — там уже всё заполнено). Набор ключей:

```
SMARTUP_URL=https://smartup.online
SMARTUP_USERNAME=...
SMARTUP_PASSWORD=...
SMARTUP_PROJECT=anor
SMARTUP_FILIAL_ID=
FIREBASE_SERVICE_ACCOUNT_JSON={...весь JSON сервис-аккаунта одной строкой...}
CRON_SECRET=...
```

> ⚠️ В `.env.local` лежат пароль Smartup и ключ Firebase. Переноси его
> **безопасно** (USB-флешка), не отправляй в мессенджеры/почту.

## 4. Запустить локально
```bash
npm run dev
```
Откроется http://localhost:3000 (виден только на этом компьютере).

## 5. Выложить изменения в прод (Vercel)
Vercel сам деплоит при пуше в ветку `master`:
```bash
git add -A
git commit -m "что изменил"
git push origin master
```
Для пуша нужен доступ к GitHub-аккаунту `khamidullox` (логин/токен).

## Где что хранится
- **Код** — GitHub (`khamidullox/frontend-next`), деплой — Vercel.
- **Данные** (товары, остатки, история проверок) — в облаке (Firestore + Smartup),
  одни и те же на всех устройствах. Ничего не хранится локально на компьютере.
- **Секреты прода** заданы в Vercel → Settings → Environment Variables
  (отдельно от `.env.local`, который только для локального запуска).
