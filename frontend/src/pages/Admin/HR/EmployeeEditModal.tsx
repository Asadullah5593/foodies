import React, { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Modal from '../../../components/Modal';
import SearchableSelect from '../../../components/SearchableSelect';
import { EmployeeDetail, hrService } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';

interface Props {
  employee: EmployeeDetail;
  onClose: () => void;
}

/**
 * Edit personal, contact and payment details.
 *
 * Branch, brand and designation are deliberately NOT here — changing those is a
 * transfer or promotion and must leave a dated assignment row, which is what
 * "Promote / transfer" does.
 *
 * Payment fields are only rendered for `salary:edit` holders; the server rejects
 * them otherwise, so showing them to everyone would just produce a confusing
 * failure on save.
 */
const field =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
const label = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

/**
 * One labelled field.
 *
 * Deliberately at module scope. Defined inside the modal — as it was — this is a
 * different component type on every render, so React throws the input away and
 * mounts a new one after each keystroke: focus is lost after one character and
 * an open date picker closes the moment you change month.
 */
const Text: React.FC<{
  title: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  /** Phone-style field: digits only, and a numeric keypad on a tablet. */
  numeric?: boolean;
  hint?: string;
}> = ({ title, value, onChange, type = 'text', placeholder, numeric, hint }) => {
  const id = useId();
  return (
  <div>
    <label className={label} htmlFor={id}>
      {title}
    </label>
    <input
      id={id}
      type={type}
      className={field}
      value={value}
      placeholder={placeholder}
      inputMode={numeric ? 'numeric' : undefined}
      // Stripped rather than refused: a pasted "+92 300 1234567" becomes the
      // number instead of silently doing nothing.
      onChange={(e) =>
        onChange(numeric ? e.target.value.replace(/[^\d]/g, '') : e.target.value)
      }
    />
    {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
  </div>
  );
};

const EmployeeEditModal: React.FC<Props> = ({ employee, onClose }) => {
  const queryClient = useQueryClient();
  const canEditSalary = useHasPermission('salary:edit');

  const [form, setForm] = useState({
    employee_code: employee.employee_code ?? '',
    full_name: employee.full_name ?? '',
    father_name: employee.father_name ?? '',
    cnic: employee.cnic ?? '',
    date_of_birth: employee.date_of_birth ?? '',
    gender: employee.gender ?? '',
    phone: employee.phone ?? '',
    address: employee.address ?? '',
    emergency_contact_name: employee.emergency_contact_name ?? '',
    emergency_contact_phone: employee.emergency_contact_phone ?? '',
    probation_end_date: employee.probation_end_date ?? '',
    confirmation_date: employee.confirmation_date ?? '',
    status: employee.status,
    bank_name: employee.bank_name ?? '',
    account_title: employee.account_title ?? '',
    account_number_iban: employee.account_number_iban ?? '',
    payment_method: employee.payment_method ?? 'cash',
  });

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    mutationFn: () => {
      // Blank strings mean "clear it", so they go as null rather than ''.
      const payload: Record<string, unknown> = {};
      const put = (key: string, value: string) => {
        payload[key] = value.trim() === '' ? null : value.trim();
      };
      put('employee_code', form.employee_code);
      put('full_name', form.full_name);
      put('father_name', form.father_name);
      put('cnic', form.cnic);
      put('date_of_birth', form.date_of_birth);
      put('gender', form.gender);
      put('phone', form.phone);
      put('address', form.address);
      put('emergency_contact_name', form.emergency_contact_name);
      put('emergency_contact_phone', form.emergency_contact_phone);
      put('probation_end_date', form.probation_end_date);
      put('confirmation_date', form.confirmation_date);
      payload.status = form.status;
      if (canEditSalary) {
        put('bank_name', form.bank_name);
        put('account_title', form.account_title);
        put('account_number_iban', form.account_number_iban);
        payload.payment_method = form.payment_method;
      }
      return hrService.updateEmployee(employee.id, payload);
    },
    onSuccess: () => {
      toast.success('Employee updated');
      queryClient.invalidateQueries({ queryKey: ['hr-employee', employee.id] });
      queryClient.invalidateQueries({ queryKey: ['hr-employees'] });
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not update the employee';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  return (
    <Modal isOpen onClose={onClose} title={`Edit ${employee.full_name}`} size="xlarge">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Identity
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Text value={form.employee_code} onChange={set('employee_code')} title="Employee code *" />
        <Text value={form.full_name} onChange={set('full_name')} title="Full name *" />
        <Text value={form.father_name} onChange={set('father_name')} title="Father's name" />
        <Text value={form.cnic} onChange={set('cnic')} title="CNIC" placeholder="35202-1234567-1" />
        <Text value={form.date_of_birth} onChange={set('date_of_birth')} title="Date of birth" type="date" />
        <div>
          <label className={label}>Gender</label>
          <SearchableSelect
            value={form.gender}
            onChange={set('gender')}
            options={[
              { value: '', label: 'Not stated' },
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
              { value: 'other', label: 'Other' },
            ]}
          />
        </div>
      </div>

      <h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Contact
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Text value={form.phone} onChange={set('phone')} title="Phone" placeholder="03001234567" numeric />
        <Text
          value={form.emergency_contact_name}
          onChange={set('emergency_contact_name')}
          title="Emergency contact name"
        />
        <Text value={form.emergency_contact_phone} onChange={set('emergency_contact_phone')} title="Emergency phone"
          placeholder="03001234567" numeric />
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={label}>Address</label>
          <textarea
            rows={2}
            className={field}
            value={form.address}
            onChange={(e) => set('address')(e.target.value)}
          />
        </div>
      </div>

      <h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Employment
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Text value={form.probation_end_date} onChange={set('probation_end_date')} title="Probation ends" type="date" />
        <Text value={form.confirmation_date} onChange={set('confirmation_date')} title="Confirmed on" type="date" />
        <div>
          <label className={label}>Status</label>
          <SearchableSelect
            value={form.status}
            onChange={set('status')}
            // Only the state a human should set by hand. Leaving and returning
            // are recorded through Leaves, and an exit sets its own status —
            // a hand-set "on leave" would just drift from the leave records.
            options={[{ value: 'active', label: 'Active' }]}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Resignations and terminations are recorded through &ldquo;Record exit&rdquo;.
          </p>
        </div>
      </div>

      {canEditSalary && (
        <>
          <h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Payment details
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className={label}>Method</label>
              <SearchableSelect
                value={form.payment_method}
                onChange={set('payment_method')}
                options={[
                  { value: 'cash', label: 'Cash' },
                  { value: 'bank_transfer', label: 'Bank transfer' },
                ]}
              />
            </div>
            <Text value={form.bank_name} onChange={set('bank_name')} title="Bank" />
            <Text value={form.account_title} onChange={set('account_title')} title="Account title" />
            <Text
              value={form.account_number_iban}
              onChange={set('account_number_iban')}
              title="Account / IBAN"
            />
          </div>
        </>
      )}

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
          disabled={
            form.full_name.trim().length < 2 ||
            form.employee_code.trim().length < 1 ||
            save.isPending
          }
          onClick={() => save.mutate()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </Modal>
  );
};

export default EmployeeEditModal;
