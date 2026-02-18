import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { adminService } from '../../services/api';
import { validatePakistaniPhone, PAKISTANI_PHONE_PLACEHOLDER } from '../../utils/phone';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';

type Customer = {
  id: number;
  name: string | null;
  phone: string;
  loyaltyPointsBalance?: number;
  createdAt?: string;
};

const Customers: React.FC = () => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [filter, setFilter] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);

  const { data: customers, isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: adminService.getCustomers,
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; phone: string }) =>
      adminService.createCustomer(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setShowForm(false);
      resetForm();
      toast.success('Customer added');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to add customer');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      adminService.updateCustomer(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setEditing(null);
      resetForm();
      toast.success('Customer updated');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update customer');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteCustomer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setDeleteTarget(null);
      toast.success('Customer removed');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to delete customer');
    },
  });

  const resetForm = () => {
    setName('');
    setPhone('');
    setPhoneError('');
  };

  const openCreate = () => {
    setEditing(null);
    resetForm();
    setShowForm(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setName(c.name ?? '');
    setPhone(c.phone);
    setPhoneError('');
    setShowForm(true);
  };

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
      const normalizedPhone = validatePakistaniPhone(phone);
      createMutation.mutate({ name: trimmedName, phone: normalizedPhone });
    }
  };

  const filtered = (customers ?? []).filter((c: Customer) => {
    if (!filter.trim()) return true;
    const q = filter.trim().toLowerCase();
    return (c.name ?? '').toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q);
  });

  if (isLoading) return <Loader fullScreen text="Loading customers..." />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Customers</h1>
        <Button onClick={openCreate}>Add customer</Button>
      </div>
      <p className="text-gray-600 mb-4">
        Name and phone (Pakistani format 03XXXXXXXXX) are required. Phone is the unique identifier for loyalty.
      </p>
      <Card className="mb-4 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Filters</h4>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or phone..."
          className="w-full max-w-sm px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
        />
      </Card>
      <Card className="p-4">
        {!customers?.length ? (
          <p className="text-center text-gray-500 py-8">No customers yet. Add one to use in POS.</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-500 py-8">No customers match the filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 text-left text-sm text-gray-600">
                  <th className="pb-3 font-medium">Name</th>
                  <th className="pb-3 font-medium">Phone</th>
                  <th className="pb-3 font-medium">Loyalty balance</th>
                  <th className="pb-3 font-medium w-40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c: Customer) => (
                  <tr key={c.id} className="border-b border-gray-100">
                    <td className="py-3 text-gray-800">{c.name ?? '—'}</td>
                    <td className="py-3 font-mono text-gray-700">{c.phone}</td>
                    <td className="py-3">{c.loyaltyPointsBalance ?? 0} pts</td>
                    <td className="py-3">
                      <div className="flex gap-2">
                        <Button size="small" variant="outline" onClick={() => openEdit(c)}>
                          Edit
                        </Button>
                        <Button size="small" variant="danger" onClick={() => setDeleteTarget(c)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete customer"
      >
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-gray-700">
              Remove <strong>{deleteTarget.name ?? '—'}</strong> ({deleteTarget.phone})? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => deleteMutation.mutate(deleteTarget.id)} isLoading={deleteMutation.isPending}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditing(null); resetForm(); }}
        title={editing ? 'Edit customer' : 'Add customer'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Customer name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone * (Pakistani: 03XXXXXXXXX)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setPhoneError(''); }}
              required
              disabled={!!editing}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              placeholder={PAKISTANI_PHONE_PLACEHOLDER}
            />
            {phoneError && <p className="mt-1 text-sm text-red-600">{phoneError}</p>}
            {editing && <p className="mt-1 text-xs text-gray-500">Phone cannot be changed (unique identifier).</p>}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); resetForm(); }}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending || updateMutation.isPending}>
              {editing ? 'Update' : 'Add'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default Customers;
