import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { MdOutlineSettings } from 'react-icons/md';
import { useHasPermission } from '../../../../hooks/useHasPermission';
import SchedulesTab from './SchedulesTab';
import CaptureTab from './CaptureTab';
import OvertimeTab from './OvertimeTab';
import OffsTab from './OffsTab';
import LeaveTypesTab from './LeaveTypesTab';
import DeductionsTab from './DeductionsTab';
import ApprovalsTab from './ApprovalsTab';

const TABS = [
  { key: 'schedules', label: 'Shifts', Component: SchedulesTab },
  { key: 'capture', label: 'Attendance capture', Component: CaptureTab },
  { key: 'overtime', label: 'Overtime', Component: OvertimeTab },
  { key: 'offs', label: 'Offs & holidays', Component: OffsTab },
  { key: 'leave-types', label: 'Leave types', Component: LeaveTypesTab },
  { key: 'deductions', label: 'Deductions', Component: DeductionsTab },
  { key: 'approvals', label: 'Approvals', Component: ApprovalsTab },
] as const;

/**
 * HR → Settings.
 *
 * Every one of these was configurable in the schema from the first phase but had
 * no way in: capture policy, overtime, offs and shift templates were seeded rows
 * that could only be changed with SQL. Each tab writes through the HR audit log,
 * so "who shortened the grace period" is answerable.
 */
const HrSettings: React.FC = () => {
  const canManage = useHasPermission('hr-settings:manage');
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('schedules');
  const Active = TABS.find((t) => t.key === tab)!.Component;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MdOutlineSettings className="text-2xl text-gray-700 dark:text-gray-200" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            HR settings
          </h1>
        </div>
        <Link
          to="/admin/hr/settings/designations"
          className="text-sm text-blue-600 hover:underline"
        >
          Designations →
        </Link>
      </div>

      {!canManage && (
        <p className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-400">
          You can see the rules your branch works under. Changing them needs
          hr-settings:manage.
        </p>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              tab === t.key
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Active />
    </div>
  );
};

export default HrSettings;
