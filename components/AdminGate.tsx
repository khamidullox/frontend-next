'use client';

import { ROLE_RANK, Role } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';

// Оборачивает страницы, требующие роль не ниже `min` (по умолчанию менеджер).
export default function AdminGate({
  children,
  min = 'manager',
}: {
  children: React.ReactNode;
  min?: Role;
}) {
  const { session } = useAuth();

  if (!session || ROLE_RANK[session.role] < ROLE_RANK[min]) {
    return (
      <div className="bg-white rounded-xl p-8 text-center text-gray-400">
        Недостаточно прав для этого раздела
      </div>
    );
  }
  return <>{children}</>;
}
