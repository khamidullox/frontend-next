'use client';

import { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { useLang, TKey } from '@/lib/i18n';
import { Role } from '@/lib/api';

const ROLE_LABEL_T: Record<Role, TKey> = {
  driver: 'role_driver', worker: 'role_worker', manager: 'role_manager', admin: 'role_admin',
};

export default function ProfilePage() {
  const { session } = useAuth();
  const { lang, setLang, t } = useLang();
  const [saved, setSaved] = useState(false);

  if (!session) return null;

  function pick(l: 'ru' | 'uz') {
    if (l === lang) return;
    setLang(l);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-md">
      <h2 className="text-xl font-bold mb-4">{t('profile_title')}</h2>

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div className="flex justify-between text-sm py-1.5 border-b border-gray-100">
          <span className="text-gray-500">{t('profile_name')}</span>
          <span className="font-medium">{session.name}</span>
        </div>
        <div className="flex justify-between text-sm py-1.5 border-b border-gray-100">
          <span className="text-gray-500">{t('profile_login')}</span>
          <span className="font-medium">@{session.username}</span>
        </div>
        <div className="flex justify-between text-sm py-1.5">
          <span className="text-gray-500">{t('profile_role')}</span>
          <span className="font-medium">{t(ROLE_LABEL_T[session.role])}</span>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="text-sm font-semibold mb-2">{t('profile_language')}</div>
        <div className="flex gap-2">
          <button
            onClick={() => pick('ru')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              lang === 'ru' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Русский
          </button>
          <button
            onClick={() => pick('uz')}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
              lang === 'uz' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Oʻzbekcha
          </button>
        </div>
        {saved && <div className="text-xs text-emerald-600 mt-2">✓ {t('profile_saved')}</div>}
      </div>
    </div>
  );
}
