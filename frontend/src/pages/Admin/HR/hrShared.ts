import { EmployeeDetail } from '../../../services/api/hrService';

/** Employment status → badge classes. */
export function statusBadgeClass(status: string): string {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  switch (status) {
    case 'active':
      return `${base} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300`;
    case 'on_leave':
      return `${base} bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300`;
    case 'suspended':
      return `${base} bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300`;
    case 'notice_period':
      return `${base} bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300`;
    case 'resigned':
    case 'terminated':
      return `${base} bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-gray-300`;
    default:
      return `${base} bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-300`;
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'on_leave':
      return 'On leave';
    case 'notice_period':
      return 'Notice period';
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

/**
 * Did the server include salary data in this payload?
 *
 * The backend OMITS the bank keys entirely for callers without `salary:view`
 * rather than sending nulls, so presence of the key is the honest test. A
 * truthiness check would hide the section from someone who is allowed to see it
 * but simply has no bank details on file yet — which reads as "permission
 * denied" when it is really "nothing entered".
 */
export function canSeeSalary(employee: EmployeeDetail): boolean {
  return 'bank_name' in employee;
}

/** Timeline event → a short glyph label, so the history reads at a glance. */
export function eventTone(eventType: string): string {
  const positive = ['hired', 'confirmed', 'promoted', 'training_completed', 'rehired'];
  const negative = [
    'demoted',
    'warning_issued',
    'suspended',
    'resigned',
    'terminated',
    'training_expired',
  ];
  if (positive.includes(eventType)) return 'bg-green-500';
  if (negative.includes(eventType)) return 'bg-red-500';
  return 'bg-gray-400';
}

export const CHANGE_REASON_LABELS: Record<string, string> = {
  hire: 'Hired',
  confirmation: 'Confirmed',
  promotion: 'Promotion',
  demotion: 'Demotion',
  transfer_branch: 'Branch transfer',
  transfer_brand: 'Brand transfer',
  designation_change: 'Designation change',
  rehire: 'Rehired',
  exit: 'Exit',
};
