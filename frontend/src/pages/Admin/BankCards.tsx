import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  MdCreditCard,
  MdEdit,
  MdDelete,
  MdAddCard,
  MdCheckCircle,
  MdInfoOutline,
} from 'react-icons/md';
import { adminService } from '../../services/api';
import Button from '../../components/Button';

type Card = {
  id: number;
  name: string;
  bank: string | null;
  network: string | null;
  bin_prefixes: string[] | null;
  is_active: boolean;
};

const emptyForm = { name: '', bank: '', network: '', bin: '', is_active: true };

const NETWORK_SUGGESTIONS = [
  'Visa',
  'Mastercard',
  'UnionPay',
  'PayPak',
  'American Express',
];

/** Split the BIN text field ("401234, 5321") into a clean prefix array. */
const parseBins = (s: string): string[] =>
  s
    .split(/[\s,]+/)
    .map((b) => b.replace(/[^0-9]/g, ''))
    .filter(Boolean);

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
        bin_prefixes: parseBins(form.bin).length ? parseBins(form.bin) : null,
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
    setForm({
      name: c.name,
      bank: c.bank ?? '',
      network: c.network ?? '',
      bin: (c.bin_prefixes ?? []).join(', '),
      is_active: c.is_active,
    });
  };

  const label = 'block text-xs font-semibold text-gray-600 dark:text-slate-300 mb-1.5';
  const input =
    'w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-gray-800 dark:text-slate-100 focus:ring-2 focus:ring-red-500/40 focus:border-red-500 outline-none transition';

  const list = (cards ?? []) as Card[];

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-900/30 flex items-center justify-center">
          <MdCreditCard className="text-red-600 dark:text-red-400" size={22} />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Bank Cards</h1>
      </div>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-6 ml-[52px]">
        The cards you run offers on. Link one from a discount's{' '}
        <span className="font-medium text-gray-600 dark:text-slate-300">“requires specific card”</span> setting,
        and it applies only when the whole bill is paid with that card.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
        {/* Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.name.trim()) return toast.error('Card name is required');
            saveMutation.mutate();
          }}
          className="bg-white dark:bg-slate-800 rounded-2xl shadow-md border border-gray-200 dark:border-slate-700 p-5 lg:sticky lg:top-6"
        >
          <div className="flex items-center gap-2 mb-4">
            <MdAddCard className="text-red-600 dark:text-red-400" size={20} />
            <h2 className="font-semibold text-gray-800 dark:text-slate-100">
              {editingId != null ? 'Edit card' : 'Add a card'}
            </h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className={label}>Card name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={input}
                placeholder="HBL Premium Debit"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>Bank</label>
                <input
                  value={form.bank}
                  onChange={(e) => setForm({ ...form, bank: e.target.value })}
                  className={input}
                  placeholder="HBL"
                />
              </div>
              <div>
                <label className={label}>Network</label>
                <input
                  value={form.network}
                  onChange={(e) => setForm({ ...form, network: e.target.value })}
                  className={input}
                  placeholder="Visa"
                  list="bank-card-networks"
                />
                <datalist id="bank-card-networks">
                  {NETWORK_SUGGESTIONS.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>
            </div>

            <div>
              <label className={label}>Card number prefixes (BIN) — optional</label>
              <input
                value={form.bin}
                onChange={(e) => setForm({ ...form, bin: e.target.value })}
                className={`${input} font-mono`}
                placeholder="401234, 5321"
              />
              <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-gray-400 dark:text-slate-500">
                <MdInfoOutline size={13} className="mt-px shrink-0" />
                First 6–8 digits printed on the card. Used to auto-detect the card at
                checkout; the cashier can also just pick it from the list.
              </p>
            </div>

            <label className="flex items-center justify-between gap-2 py-1 cursor-pointer select-none">
              <span className="text-sm font-medium text-gray-700 dark:text-slate-200">Active</span>
              <span className="relative inline-flex">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                />
                <span className="w-11 h-6 rounded-full bg-gray-300 dark:bg-slate-600 peer-checked:bg-red-600 transition-colors" />
                <span className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
              </span>
            </label>

            <div className="flex gap-2 pt-1">
              <Button type="submit" variant="gradient" isLoading={saveMutation.isPending} className="flex-1">
                {editingId != null ? 'Save changes' : 'Add card'}
              </Button>
              {editingId != null && (
                <Button type="button" variant="outline" onClick={reset}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </form>

        {/* List */}
        <div>
          {isLoading ? (
            <div className="text-gray-500 dark:text-slate-400 py-12 text-center">Loading…</div>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-2xl">
              <MdCreditCard className="text-gray-300 dark:text-slate-600 mb-3" size={44} />
              <p className="font-medium text-gray-600 dark:text-slate-300">No bank cards yet</p>
              <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">
                Add a card on the left, then link it to a discount.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {list.map((c) => (
                <div
                  key={c.id}
                  className={`group relative overflow-hidden rounded-2xl p-5 shadow-md text-white transition ${
                    c.is_active
                      ? 'bg-gradient-to-br from-slate-900 via-slate-800 to-red-900'
                      : 'bg-gradient-to-br from-slate-500 to-slate-600 opacity-80'
                  }`}
                >
                  {/* decorative chip */}
                  <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/5" />
                  <div className="flex items-start justify-between">
                    <div className="w-9 h-7 rounded-md bg-yellow-400/80" />
                    <span className="text-sm font-semibold tracking-wide uppercase opacity-90">
                      {c.network || ''}
                    </span>
                  </div>

                  <div className="mt-6 font-semibold text-lg leading-tight">{c.name}</div>

                  <div className="mt-3 flex items-end justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wider opacity-60">Bank</div>
                      <div className="text-sm font-medium truncate">{c.bank || '—'}</div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1 max-w-[55%]">
                      {(c.bin_prefixes ?? []).slice(0, 3).map((b) => (
                        <span
                          key={b}
                          className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/15"
                        >
                          {b}•••
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* status badge */}
                  {c.is_active ? (
                    <span className="absolute bottom-3 right-4 flex items-center gap-1 text-[10px] text-emerald-300/90">
                      <MdCheckCircle size={12} /> Active
                    </span>
                  ) : (
                    <span className="absolute bottom-3 right-4 text-[10px] font-semibold uppercase tracking-wide text-white/80">
                      Inactive
                    </span>
                  )}

                  {/* actions (hover) */}
                  <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => startEdit(c)}
                      title="Edit"
                      className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center"
                    >
                      <MdEdit size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Remove "${c.name}"?`)) deleteMutation.mutate(c.id);
                      }}
                      title="Delete"
                      className="w-8 h-8 rounded-lg bg-white/15 hover:bg-red-500/70 flex items-center justify-center"
                    >
                      <MdDelete size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BankCards;
