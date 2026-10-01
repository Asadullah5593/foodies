import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { adminService } from '../services/api';
import { validatePakistaniPhone, PAKISTANI_PHONE_PLACEHOLDER } from '../utils/phone';
import Button from './Button';
import Modal from './Modal';

type Editable = { id: number; name: string | null; phone: string };

/**
 * Add a customer, or rename an existing one (the phone is their identity and
 * cannot be changed). Adding a phone that already belongs to a customer under
 * another brand offers to link them instead. Shared by the Customers table and
 * the customer detail page.
 */
const CustomerFormModal: React.FC<{
  isOpen: boolean;
  /** The customer being edited; null/undefined adds a new one. */
  customer?: Editable | null;
  onClose: () => void;
  /** Called after a successful save, once the customer queries are refreshed. */
  onSaved?: () => void;
}> = ({ isOpen, customer, onClose, onSaved }) => {
  const queryClient = useQueryClient();
  const editing = customer ?? null;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [linkConfirm, setLinkConfirm] = useState<{ name: string; phone: string; existingName: string | null } | null>(null);

  // Start each opening from the record (or blank), never from the last edit.
  useEffect(() => {
    if (!isOpen) return;
    setName(editing?.name ?? '');
    setPhone(editing?.phone ?? '');
    setPhoneError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, editing?.id]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['customers'] });
    queryClient.invalidateQueries({ queryKey: ['customer-summary'] });
  };

  const createMutation = useMutation({
    mutationFn: (data: { name: string; phone: string; link?: boolean }) => adminService.createCustomer(data),
    onSuccess: (created: { linked?: boolean }) => {
      refresh();
      setLinkConfirm(null);
      onClose();
      onSaved?.();
      toast.success(created?.linked ? 'Linked existing customer' : 'Customer added');
    },
    onError: (err: any, variables) => {
      const existing = err.response?.status === 409 ? err.response?.data?.existing : null;
      if (existing) {
        onClose();
        setLinkConfirm({ name: variables.name, phone: variables.phone, existingName: existing.name ?? null });
        return;
      }
      toast.error(err.response?.data?.message || 'Failed to add customer');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => adminService.updateCustomer(id, { name }),
    onSuccess: () => {
      refresh();
      onClose();
      onSaved?.();
      toast.success('Customer updated');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update customer');
    },
  });

  const validatePhone = (): boolean => {
    if (!phone.trim()) {
      setPhoneError('Phone is required');
      return false;
    }
    try {
      validatePakistaniPhone(phone);
      setPhoneError('');
      return true;
    } catch {
      setPhoneError('Use Pakistani format: 03XXXXXXXXX (e.g. 03001234567)');
      return false;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Customer name is required');
      return;
    }
    if (!validatePhone()) return;
    if (editing) {
      updateMutation.mutate({ id: editing.id, name: trimmedName });
    } else {
      createMutation.mutate({ name: trimmedName, phone: validatePakistaniPhone(phone) });
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={editing ? 'Edit customer' : 'Add customer'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="customer-form-name" className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">Name *</label>
            <input
              id="customer-form-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              placeholder="Customer name"
            />
          </div>
          <div>
            <label htmlFor="customer-form-phone" className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">Phone * (Pakistani: 03XXXXXXXXX)</label>
            <input
              id="customer-form-phone"
              type="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setPhoneError(''); }}
              required
              disabled={!!editing}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700"
              placeholder={PAKISTANI_PHONE_PLACEHOLDER}
            />
            {phoneError && <p className="mt-1 text-sm text-red-600">{phoneError}</p>}
            {editing && <p className="mt-1 text-xs text-gray-500">Phone cannot be changed (unique identifier).</p>}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>
              {editing ? 'Update' : 'Add'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={linkConfirm != null} onClose={() => setLinkConfirm(null)} title="Customer already exists">
        {linkConfirm && (
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-slate-200">
              <span className="font-mono">{linkConfirm.phone}</span> already belongs to{' '}
              <strong>{linkConfirm.existingName ?? 'an existing customer'}</strong> under another brand.
              Link this customer to your brand?
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setLinkConfirm(null)}>Cancel</Button>
              <Button
                isLoading={createMutation.isPending}
                onClick={() => createMutation.mutate({ name: linkConfirm.name, phone: linkConfirm.phone, link: true })}
              >
                Link customer
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

export default CustomerFormModal;
