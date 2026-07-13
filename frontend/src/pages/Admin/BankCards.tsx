import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdCreditCard, MdEdit, MdDelete, MdAddCard, MdInfoOutline } from 'react-icons/md';
import { adminService } from '../../services/api';
import SegToggle from '../../components/SegToggle';
import { offerInput, offerLabel } from '../../components/OfferModal';

type Card = {
  id: number;
  name: string;
  bank: string | null;
  network: string | null;
  bin_prefixes: string[] | null;
  is_active: boolean;
};

const emptyForm = { name: '', bank: '', network: '', bin: '', is_active: true };

const NETWORK_SUGGESTIONS = ['Visa', 'Mastercard', 'UnionPay', 'PayPak', 'American Express'];

/** Dark card-face gradients, cycled per card (matches the design). */
const CARD_GRADIENTS = [
  'linear-gradient(135deg,#2A2E3A 0%,#3A2226 55%,#5A1E22 100%)',
  'linear-gradient(135deg,#1E2530 0%,#243244 60%,#2E4560 100%)',
  'linear-gradient(135deg,#2A1E24 0%,#4A1E2A 55%,#6E2230 100%)',
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

  const list = (cards ?? []) as Card[];
  const activeCount = list.filter((c) => c.is_active).length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Card name is required');
    saveMutation.mutate();
  };

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-12">
      {/* Header */}
      <div className="mb-8 flex items-start gap-4">
        <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl bg-red-50 text-red-600">
          <MdCreditCard size={24} />
        </span>
        <div>
          <h1 className="mb-1.5 text-2xl font-extrabold tracking-tight text-gray-800 sm:text-[28px]">Bank Cards</h1>
          <p className="max-w-[680px] text-[14.5px] leading-relaxed text-gray-500">
            The cards you run offers on. Link one from a discount's{' '}
            <span className="font-semibold text-gray-700">“requires specific card”</span> setting — it applies only when the whole bill is paid with that card.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[380px_1fr]">
        {/* Form */}
        <form
          onSubmit={submit}
          className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)] lg:sticky lg:top-6"
        >
          <div className="flex items-center gap-2.5 border-b border-gray-100 px-[22px] py-[18px]">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-red-50 text-red-600">
              <MdAddCard size={17} />
            </span>
            <span className="text-[16px] font-bold text-gray-800">{editingId != null ? 'Edit card' : 'Add a card'}</span>
          </div>
          <div className="flex flex-col gap-[17px] px-[22px] py-5">
            <div>
              <label className={offerLabel}>Card name <span className="text-red-500">*</span></label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={offerInput} placeholder="HBL Premium Debit" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={offerLabel}>Bank</label>
                <input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} className={offerInput} placeholder="HBL" />
              </div>
              <div>
                <label className={offerLabel}>Network</label>
                <input value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} className={offerInput} placeholder="Visa" list="bank-card-networks" />
                <datalist id="bank-card-networks">
                  {NETWORK_SUGGESTIONS.map((n) => <option key={n} value={n} />)}
                </datalist>
              </div>
            </div>
            <div>
              <label className={offerLabel}>Card number prefixes (BIN) <span className="font-normal text-gray-400">— optional</span></label>
              <input value={form.bin} onChange={(e) => setForm({ ...form, bin: e.target.value })} className={`${offerInput} font-mono`} placeholder="401234, 5321" />
              <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-gray-400">
                <MdInfoOutline size={14} className="mt-px shrink-0" />
                First 6–8 digits printed on the card. Used to auto-detect the card at checkout; the cashier can also just pick it from the list.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-[11px] border border-gray-100 bg-gray-50 px-3.5 py-3">
              <div>
                <div className="text-[13.5px] font-semibold text-gray-700">Active</div>
                <div className="text-[12px] text-gray-400">Available to link on offers</div>
              </div>
              <SegToggle on={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} ariaLabel="Active" />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saveMutation.isPending} className="flex-1 rounded-[11px] bg-red-600 px-4 py-3 text-[15px] font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 active:scale-[0.98] disabled:opacity-60">
                {editingId != null ? 'Save changes' : '+ Add card'}
              </button>
              {editingId != null && (
                <button type="button" onClick={reset} className="rounded-[11px] border-[1.5px] border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50">Cancel</button>
              )}
            </div>
          </div>
        </form>

        {/* List */}
        <div>
          <div className="mb-3.5 flex items-center justify-between">
            <span className="text-[12px] font-bold uppercase tracking-wider text-gray-400">Linked cards · {list.length}</span>
            <span className="text-[12.5px] text-gray-400">{activeCount} active</span>
          </div>
          {isLoading ? (
            <div className="py-12 text-center text-gray-500">Loading…</div>
          ) : (
            <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2">
              {list.map((c, i) => (
                <div
                  key={c.id}
                  className={`relative flex min-h-[186px] flex-col justify-between overflow-hidden rounded-2xl p-[22px] text-white shadow-[0_14px_30px_rgba(15,23,42,0.16)] ${c.is_active ? '' : 'opacity-70 grayscale'}`}
                  style={{ background: CARD_GRADIENTS[i % CARD_GRADIENTS.length] }}
                >
                  <div className="pointer-events-none absolute -right-10 -top-10 h-[170px] w-[170px] rounded-full bg-white/5" />
                  <div className="pointer-events-none absolute -bottom-8 right-5 h-[120px] w-[120px] rounded-full bg-white/[0.04]" />
                  <div className="relative flex items-start justify-between">
                    <span className="h-[34px] w-[46px] rounded-[7px]" style={{ background: 'linear-gradient(135deg,#F0CE6B,#D6A833)', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.1)' }} />
                    <div className="flex items-center gap-2.5">
                      <span className="text-[12px] font-extrabold uppercase tracking-[0.1em] text-white/80">{c.network || ''}</span>
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => startEdit(c)} title="Edit" className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-white/[0.14] text-white transition-colors hover:bg-white/25">
                          <MdEdit size={15} />
                        </button>
                        <button type="button" onClick={() => { if (confirm(`Remove "${c.name}"?`)) deleteMutation.mutate(c.id); }} title="Delete" className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-white/[0.14] text-red-200 transition-colors hover:bg-red-500/60">
                          <MdDelete size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="relative">
                    <div className="mb-3.5 text-[19px] font-bold tracking-tight text-white">{c.name}</div>
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <div className="mb-0.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/50">Bank</div>
                        <div className="text-[14px] font-semibold tracking-wide text-white/90">{c.bank || '—'}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-[14px] tracking-[0.08em] text-white/70">{(c.bin_prefixes ?? [])[0] || '••••'} ••••</div>
                        {c.is_active ? (
                          <span className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Active
                          </span>
                        ) : (
                          <span className="mt-1.5 inline-block text-[11px] font-bold uppercase tracking-wide text-white/70">Inactive</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Add-another tile */}
              <button
                type="button"
                onClick={() => { reset(); document.querySelector<HTMLInputElement>('input[placeholder="HBL Premium Debit"]')?.focus(); }}
                className="flex min-h-[186px] flex-col items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-gray-300 bg-gray-50 text-gray-400 transition-colors hover:border-red-500 hover:text-red-600"
              >
                <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full border-[1.5px] border-current bg-white text-[22px] font-light leading-none">+</span>
                <span className="text-[13.5px] font-semibold">Add another card</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BankCards;
