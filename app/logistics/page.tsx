'use client';

import AdminGate from '@/components/AdminGate';

interface Feature {
  icon: string;
  title: string;
  desc: string;
}

// Предлагаемые возможности раздела — обсуждаем и включаем по очереди.
const FEATURES: Feature[] = [
  { icon: '🚚', title: 'Доставки заказов', desc: 'Список заказов клиентам: дата доставки, адрес, машина и водитель, статус (ожидает / в пути / доставлено / возврат).' },
  { icon: '🗺️', title: 'Маршруты на день', desc: 'Группировка доставок по районам/маршрутам, порядок объезда, лист маршрута для водителя.' },
  { icon: '🔄', title: 'Перемещения между складами', desc: 'Заявки на перемещение товара со склада на склад, отслеживание «в пути → принято».' },
  { icon: '👷', title: 'Водители и транспорт', desc: 'Справочник машин и водителей, занятость, к какой доставке привязан.' },
  { icon: '📅', title: 'График доставок', desc: 'Календарь: что и когда отгружается/доставляется, нагрузка по дням.' },
  { icon: '📦', title: 'Статусы и история', desc: 'Журнал по каждой доставке: кто принял, когда, фото/подпись, причины возврата.' },
];

export default function LogisticsPage() {
  return (
    <AdminGate min="manager">
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="text-xl font-bold">🚚 Логистика</h2>
          <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700">в разработке</span>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-4 mb-4 text-sm text-gray-600 leading-relaxed">
          Раздел для менеджеров и админов. Ниже — что можно сюда добавить. Скажи, что нужно в первую очередь,
          и какие данные брать из Smartup (заказы, перемещения) — реализуем по очереди.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {FEATURES.map(f => (
            <div key={f.title} className="bg-white rounded-xl shadow-sm p-4 hover:ring-2 hover:ring-blue-100 transition-all">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl">{f.icon}</span>
                <span className="font-semibold text-sm">{f.title}</span>
              </div>
              <p className="text-[13px] text-gray-500 leading-snug">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </AdminGate>
  );
}
