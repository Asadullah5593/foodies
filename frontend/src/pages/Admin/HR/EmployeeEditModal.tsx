import React, { useState } from 'react';
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

  const field =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
  const label = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

  const Text: React.FC<{
    k: keyof typeof form;
    title: string;
    type?: string;
    placeholder?: string;
  }> = ({ k, title, type = 'text', placeholder }) => (
    <div>
      <label className={label}>{title}</label>
      <input
        type={type}
        className={field}
        value={form[k]}
        placeholder={placeholder}
        onChange={(e) => set(k)(e.target.value)}
      />
    </div>
  );

  return (
    <Modal isOpen onClose={onClose} title={`Edit ${employee.full_name}`} size="xlarge">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
        Identity
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Text k="employee_code" title="Employee code *" />
        <Text k="full_name" title="Full name *" />
        <Text k="father_name" title="Father's name" />
        <Text k="cnic" title="CNIC" placeholder="35202-1234567-1" />
        <Text k="date_of_birth" title="Date of birth" type="date" />
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
        <Text k="phone" title="Phone" placeholder="03001234567" />
        <Text k="emergency_contact_name" title="Emergency contact" />
        <Text k="emergency_contact_phone" title="Emergency phone" />
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
        <Text k="probation_end_date" title="Probation ends" type="date" />
        <Text k="confirmation_date" title="Confirmed on" type="date" />
        <div>
          <label className={label}>Status</label>
          <SearchableSelect
            value={form.status}
            onChange={set('status')}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'on_leave', label: 'On leave' },
              { value: 'suspended', label: 'Suspended' },
            ]}
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
            <Text k="bank_name" title="Bank" />
            <Text k="account_title" title="Account title" />
            <Text k="account_number_iban" title="Account / IBAN" />
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
