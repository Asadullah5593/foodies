import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { adminService } from '../../services/api';
import { validatePakistaniPhone, PAKISTANI_PHONE_PLACEHOLDER } from '../../utils/phone';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';

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
  const debouncedFilter = useDebouncedValue(filter, 300);
  const [page, setPage] = useState(1);
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

  const filtered = React.useMemo(() => {
    const list = (customers ?? []) as Customer[];
    if (!debouncedFilter.trim()) return list;
    const q = debouncedFilter.trim().toLowerCase();
    return list.filter((c) => (c.name ?? '').toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q));
  }, [customers, debouncedFilter]);

  const customerNameTypeahead = useTypeaheadSuggestions({
    query: debouncedFilter,
    options: ((customers ?? []) as Customer[])
      .map((c) => ({ id: String(c.id), label: (c.name ?? '').trim() }))
      .filter((o) => o.label !== ''),
    minChars: 2,
    limit: 8,
  });

  const paginatedFiltered = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return filtered.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filtered, page]);
  React.useEffect(() => setPage(1), [debouncedFilter]);

  const isSubmitting = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading customers...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Customers</h1>
        <Button variant="primary" onClick={openCreate}>Add customer</Button>
      </div>
      <p className="text-gray-600 mb-4">
        Name and phone (Pakistani format 03XXXXXXXXX) are required. Phone is the unique identifier for loyalty.
      </p>
      <Card className="mb-4 p-4">
        <div className="relative w-full max-w-sm">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onFocus={() => customerNameTypeahead.setOpen(true)}
            onKeyDown={(e) => {
              const suggestions = customerNameTypeahead.suggestions;
              if (!suggestions.length) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                customerNameTypeahead.setActiveIndex(Math.min(customerNameTypeahead.activeIndex + 1, suggestions.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                customerNameTypeahead.setActiveIndex(Math.max(customerNameTypeahead.activeIndex - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const opt = suggestions[customerNameTypeahead.activeIndex];
                if (opt?.label) setFilter(opt.label);
                customerNameTypeahead.setOpen(false);
              } else if (e.key === 'Escape') {
                customerNameTypeahead.setOpen(false);
              }
            }}
            placeholder="Filter by name or phone..."
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          <TypeaheadDropdown
            open={customerNameTypeahead.open && filter.trim().length >= 2}
            suggestions={customerNameTypeahead.suggestions}
            activeIndex={customerNameTypeahead.activeIndex}
            onHoverIndex={customerNameTypeahead.setActiveIndex}
            onSelect={(opt) => {
              setFilter(opt.label);
              customerNameTypeahead.setOpen(false);
            }}
            onClose={() => customerNameTypeahead.setOpen(false)}
          />
        </div>
      </Card>
      <div className="w-full space-y-3">
        {!customers?.length ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No customers yet. Add one to use in POS.</p>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No customers match the filter.</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedFiltered.map((c: Customer, i: number) => (
                <AccentedListRow
                  key={c.id}
                  accent="active"
                  initial={(c.name ?? 'C').charAt(0)}
                  title={c.name ?? '—'}
                  subtitle={<><p className="font-mono">{c.phone}</p><p>Loyalty: {c.loyaltyPointsBalance ?? 0} pts</p></>}
                  animationIndex={i}
                  actions={
                    <>
                      <Button size="small" variant="edit" onClick={() => openEdit(c)}>Edit</Button>
                      <Button size="small" variant="danger" onClick={() => setDeleteTarget(c)}>Delete</Button>
                    </>
                  }
                />
              ))}
            </AccentedList>
            <PaginationBar totalCount={filtered.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="customers" />
          </>
        )}
      </div>

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
