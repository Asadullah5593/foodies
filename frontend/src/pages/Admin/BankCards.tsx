import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { adminService } from '../../services/api';

type Card = {
  id: number;
  name: string;
  bank: string | null;
  network: string | null;
  bin_prefixes: string[] | null;
  is_active: boolean;
};

const emptyForm = { name: '', bank: '', network: '', is_active: true };

/** Manage the tenant's bank cards used by card-linked discounts (e.g. "HBL Premium Debit"). */
const BankCards: React.FC = () => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: cards, isLoading } = useQuery({
    queryKey: ['bank-cards'],
    queryFn: () => adminService.getBankCards(false),
  });

  const reset = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        bank: form.bank.trim() || null,
        network: form.network.trim() || null,
        is_active: form.is_active,
      };
      return editingId != null
        ? adminService.updateBankCard(editingId, payload)
        : adminService.createBankCard(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-cards'] });
      toast.success(editingId != null ? 'Bank card updated' : 'Bank card added');
      reset();
    },
    onError: (e: unknown) =>
      toast.error(
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ||
          'Failed to save bank card',
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteBankCard(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-cards'] });
      toast.success('Bank card removed');
    },
  });

  const startEdit = (c: Card) => {
    setEditingId(c.id);
    setForm({ name: c.name, bank: c.bank ?? '', network: c.network ?? '', is_active: c.is_active });
  };

  const input =
    'w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100';

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-1">Bank Cards</h1>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
        Cards you run offers on. Reference them from a discount's "requires specific card" setting.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim()) return toast.error('Card name is required');
          saveMutation.mutate();
        }}
        className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end mb-8 bg-gray-50 dark:bg-slate-800 p-4 rounded-xl"
      >
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Card name *</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} placeholder="HBL Premium Debit" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Bank</label>
          <input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} className={input} placeholder="HBL" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Network</label>
          <input value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} className={input} placeholder="Visa / debit" />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
          Active
        </label>
        <div className="flex gap-2">
          <button type="submit" disabled={saveMutation.isPending} className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
            {editingId != null ? 'Update' : 'Add card'}
          </button>
          {editingId != null && (
            <button type="button" onClick={reset} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-sm">
              Cancel
            </button>
          )}
        </div>
      </form>

      {isLoading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (cards ?? []).length === 0 ? (
        <p className="text-gray-500 dark:text-slate-400">No bank cards yet.</p>
      ) : (
        <div className="divide-y divide-gray-200 dark:divide-slate-700 border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
          {(cards as Card[]).map((c) => (
            <div key={c.id} className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-800">
              <div>
                <span className="font-medium text-gray-900 dark:text-slate-100">{c.name}</span>
                {c.bank && <span className="text-sm text-gray-500 dark:text-slate-400"> · {c.bank}</span>}
                {!c.is_active && <span className="ml-2 text-xs text-amber-600">(inactive)</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEdit(c)} className="text-sm text-blue-600 hover:underline">Edit</button>
                <button
                  onClick={() => {
                    if (confirm(`Remove "${c.name}"?`)) deleteMutation.mutate(c.id);
                  }}
                  className="text-sm text-red-600 hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BankCards;
