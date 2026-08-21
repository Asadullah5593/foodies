import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Modal from '../../../components/Modal';
import { Designation, hrService } from '../../../services/api/hrService';
import SearchableSelect from '../../../components/SearchableSelect';

type BranchOption = { id: number; name: string };
type BrandOption = { id: number; name: string };

interface Props {
  designations: Designation[];
  branches: BranchOption[];
  brands?: BrandOption[];
  onClose: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Create an employee and their first (hire) assignment.
 *
 * Branch and designation are required because the backend writes both rows in
 * one transaction — an employee with no assignment is invisible to every scoped
 * query. Brand is optional on purpose: leaving it blank marks shared branch
 * staff (cleaner, security, porter), who stay visible to every manager at that
 * branch.
 */
const EmployeeFormModal: React.FC<Props> = ({ designations, branches, brands = [], onClose }) => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    full_name: '',
    employee_code: '',
    phone: '',
    cnic: '',
    branch_id: '' as number | '',
    brand_id: '' as number | '',
    designation_id: '' as number | '',
    employment_type: 'full_time',
    date_of_joining: today(),
    user_id: '' as number | '',
  });

  // Logins that belong to nobody yet. Without this the form had no way to say
  // "this person already exists in the system", so adding a cashier who already
  // logs into the POS created a second identity for the same human — their
  // shifts on one record, their attendance and pay on another.
  const { data: linkableUsers = [] } = useQuery({
    queryKey: ['hr-linkable-users'],
    queryFn: () => hrService.listLinkableUsers(),
  });

  /** A login whose name looks like the one being typed. */
  const likelyMatch = useMemo(() => {
    const typed = form.full_name.trim().toLowerCase();
    if (typed.length < 3 || form.user_id !== '') return null;
    return (
      linkableUsers.find(
        (u) =>
          u.name.toLowerCase() === typed ||
          u.name.toLowerCase().includes(typed) ||
          typed.includes(u.name.toLowerCase()),
      ) ?? null
    );
  }, [form.full_name, form.user_id, linkableUsers]);

  const set = (key: keyof typeof form) => (value: string | number) =>
    setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: () =>
      hrService.createEmployee({
        full_name: form.full_name.trim(),
        employee_code: form.employee_code.trim() || undefined,
        phone: form.phone.trim() || undefined,
        cnic: form.cnic.trim() || undefined,
        branch_id: Number(form.branch_id),
        brand_id: form.brand_id === '' ? undefined : Number(form.brand_id),
        designation_id: Number(form.designation_id),
        employment_type: form.employment_type,
        date_of_joining: form.date_of_joining,
        user_id: form.user_id === '' ? undefined : Number(form.user_id),
      }),
    onSuccess: (result) => {
      toast.success(`Employee ${result.employee_code} created`);
      queryClient.invalidateQueries({ queryKey: ['hr-employees'] });
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not create the employee';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const valid =
    form.full_name.trim().length >= 2 &&
    form.branch_id !== '' &&
    form.designation_id !== '' &&
    !!form.date_of_joining;

  const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
  const label = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

  return (
    <Modal isOpen onClose={onClose} title="Add employee" size="xlarge">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="sm:col-span-2">
          <label className={label}>Full name *</label>
          <input
            className={field}
            value={form.full_name}
            onChange={(e) => set('full_name')(e.target.value)}
            placeholder="Bilal Ahmed"
          />
        </div>

        <div>
          <label className={label}>Employee code</label>
          <input
            className={field}
            value={form.employee_code}
            onChange={(e) => set('employee_code')(e.target.value)}
            placeholder="Auto-generated if blank"
          />
        </div>

        <div>
          <label className={label}>Phone</label>
          <input
            className={field}
            value={form.phone}
            onChange={(e) => set('phone')(e.target.value)}
            placeholder="03001234567"
          />
        </div>

        <div>
          <label className={label}>CNIC</label>
          <input
            className={field}
            value={form.cnic}
            onChange={(e) => set('cnic')(e.target.value)}
            placeholder="35202-1234567-1"
          />
        </div>

        <div>
          <label className={label}>Joining date *</label>
          <input
            type="date"
            className={field}
            value={form.date_of_joining}
            onChange={(e) => set('date_of_joining')(e.target.value)}
          />
        </div>

        <div>
          <label className={label}>Branch *</label>
          <SearchableSelect
            value={form.branch_id === '' ? '' : String(form.branch_id)}
            onChange={(v) => set('branch_id')(v === '' ? '' : Number(v))}
            options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
            placeholder="Select a branch"
            searchPlaceholder="Search branches…"
          />
        </div>

        <div>
          <label className={label}>Brand</label>
          {/* A brand only means something once a branch is chosen — brands are
              linked to branches, so offering them first invites a combination
              that does not exist. */}
          <SearchableSelect
            disabled={form.branch_id === ''}
            value={form.brand_id === '' ? '' : String(form.brand_id)}
            onChange={(v) => set('brand_id')(v === '' ? '' : Number(v))}
            options={[
              { value: '', label: 'Shared — not tied to a brand' },
              ...brands.map((b) => ({ value: String(b.id), label: b.name })),
            ]}
            placeholder={
              form.branch_id === '' ? 'Pick a branch first' : 'Shared — not tied to a brand'
            }
            searchPlaceholder="Search brands…"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {form.branch_id === ''
              ? 'Choose a branch to pick a brand.'
              : 'Leave blank for cleaners, security and other staff shared across brands.'}
          </p>
        </div>

        <div>
          <label className={label}>Designation *</label>
          <SearchableSelect
            value={form.designation_id === '' ? '' : String(form.designation_id)}
            onChange={(v) => set('designation_id')(v === '' ? '' : Number(v))}
            options={designations.map((d) => ({
              value: String(d.id),
              label: `${d.name} (level ${d.level})`,
            }))}
            placeholder="Select a designation"
            searchPlaceholder="Search designations…"
          />
        </div>

        <div>
          <label className={label}>Employment type</label>
          <SearchableSelect
            value={form.employment_type}
            onChange={(v) => set('employment_type')(v)}
            options={[
              { value: 'full_time', label: 'Full time' },
              { value: 'part_time', label: 'Part time' },
              { value: 'contract', label: 'Contract' },
              { value: 'probation', label: 'Probation' },
            ]}
          />
        </div>

        <div className="sm:col-span-2 lg:col-span-3">
          <label className={label}>System login</label>
          <SearchableSelect
            ariaLabel="System login"
            value={form.user_id === '' ? '' : String(form.user_id)}
            onChange={(v) => set('user_id')(v === '' ? '' : Number(v))}
            options={[
              { value: '', label: 'No login — HR record only' },
              ...linkableUsers.map((u) => ({
                value: String(u.id),
                label: `${u.name}${u.email ? ` · ${u.email}` : ''}${
                  u.role_name ? ` · ${u.role_name}` : ''
                }`,
              })),
            ]}
            placeholder="No login — HR record only"
            searchPlaceholder="Search by name, email or phone…"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Link this person to their POS or admin account, so their till shifts
            and their attendance belong to one record. Most staff — cooks,
            cleaners, guards — have no login, and that is normal. Only accounts
            not already attached to somebody are listed.
          </p>
          {likelyMatch && (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
              <span>
                <strong>{likelyMatch.name}</strong> already has a login
                {likelyMatch.email ? ` (${likelyMatch.email})` : ''}. Same person?
              </span>
              <button
                type="button"
                onClick={() => set('user_id')(likelyMatch.id)}
                className="rounded border border-amber-500 px-2 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40"
              >
                Link it
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? 'Saving…' : 'Create employee'}
        </button>
      </div>
    </Modal>
  );
};

export default EmployeeFormModal;
