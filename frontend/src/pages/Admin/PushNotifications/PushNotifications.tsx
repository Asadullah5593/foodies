import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MdOutlineCampaign } from 'react-icons/md';
import { pushService } from '../../../services/api';
import { useHasPermission } from '../../../hooks/useHasPermission';
import { cu } from '../customersUi';
import OverviewTab from './OverviewTab';
import MessagesTab from './MessagesTab';
import AudiencesTab from './AudiencesTab';
import TemplatesTab from './TemplatesTab';
import SettingsTab from './SettingsTab';

const TABS = [
  { key: 'notifications', label: 'Notifications' },
  { key: 'overview', label: 'Overview' },
  { key: 'audiences', label: 'Audiences' },
  { key: 'templates', label: 'Templates' },
  { key: 'settings', label: 'Settings' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/**
 * Push notifications to customers who have the app: promos, announcements and
 * repeating automations. The automatic order-status notifications are separate
 * and are not managed here.
 */
const PushNotifications: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'notifications') as Tab;
  const canSend = useHasPermission('push-notifications:send');
  const canSettings = useHasPermission('push-notifications:settings');
  const { data: meta } = useQuery({ queryKey: ['push-meta'], queryFn: pushService.meta });

  return (
    <div className={cu.page}>
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl bg-red-50 text-red-600 dark:bg-red-900/30">
          <MdOutlineCampaign size={24} />
        </span>
        <div className="min-w-[260px] flex-1">
          <h1 className={`mb-1 text-2xl font-extrabold tracking-tight sm:text-[28px] ${cu.strong}`}>Push Notifications</h1>
          <p className={`max-w-[760px] text-[14px] leading-relaxed ${cu.muted}`}>
            Send promos and announcements to customers who have the app — now, at a set time, or on repeat — to everyone or to the customers you pick, and
            see the orders they bring in. Order-status updates still go out on their own.
          </p>
        </div>
        {canSend && (
          <Link
            to="/admin/push-notifications/new"
            className="inline-flex flex-none items-center gap-2 rounded-[11px] bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700"
          >
            <span className="text-lg leading-none">+</span>New notification
          </Link>
        )}
      </div>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-[#ECEDF0] dark:border-slate-700" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setParams(t.key === 'notifications' ? {} : { tab: t.key })}
            className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13.5px] font-semibold ${
              tab === t.key ? 'border-red-600 text-red-600 dark:text-red-400' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'notifications' && <MessagesTab meta={meta} canSend={canSend} />}
      {tab === 'overview' && <OverviewTab canSend={canSend} canSettings={canSettings} />}
      {tab === 'audiences' && <AudiencesTab meta={meta} canSend={canSend} />}
      {tab === 'templates' && <TemplatesTab meta={meta} canSend={canSend} />}
      {tab === 'settings' && <SettingsTab canEdit={canSettings} />}
    </div>
  );
};

export default PushNotifications;
