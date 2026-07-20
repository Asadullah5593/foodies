import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdCreditCard, MdEdit, MdDelete, MdAddCard, MdInfoOutline } from 'react-icons/md';
import { adminService } from '../../services/api';
import SegToggle from '../../components/SegToggle';
import OfferModal, { offerInput, offerLabel } from '../../components/OfferModal';
import SearchableMultiSelect, {
  SearchableMultiSelectOption,
} from '../../components/SearchableMultiSelect';
import { useAuth } from '../../contexts/AuthContext';
import {
  BrandScoped,
  BrandScopeBadge,
  BrandScopeNotice,
  canEdit,
  removeDialog,
  removeLabel,
} from '../../components/OfferBrandScope';
import { useHasPermission } from '../../hooks/useHasPermission';
import apiClient from '../../utils/apiClient';
import { confirmDialog } from '../../utils/sweetAlert';
import ValidityFields, { emptyValidity } from '../../components/ValidityFields';
import BankCardBinLookup from '../../components/BankCardBinLookup';

type Card = BrandScoped & {
  id: number;
  name: string;
  bank: string | null;
  network: string | null;
  bin_prefixes: string[] | null;
  eligibility_brand_ids?: number[] | null;
  discount_type?: 'flat' | 'percentage' | null;
  discount_value?: number | null;
  min_order_amount?: number | null;
  max_discount_amount?: number | null;
  valid_from?: string | null;
  valid_until?: string | null;
  valid_time_start?: string | null;
  valid_time_end?: string | null;
  valid_days_of_week?: number[] | null;
  has_offer?: boolean;
  is_active: boolean;
};

const emptyForm = {
  name: '',
  bank: '',
  network: '',
  bin: '',
  eligibility_brand_ids: [] as number[],
  discount_type: 'percentage' as 'flat' | 'percentage',
  discount_value: '' as number | '',
  min_order_amount: '' as number | '',
  max_discount_amount: '' as number | '',
  is_active: true,
  ...emptyValidity,
};

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

/** What the card face says the customer gets: "25% off" / "Rs. 200 off". */
const discountText = (c: Card): string => {
  const v = Number(c.discount_value ?? 0);
  if (!v) return '';
  return c.discount_type === 'flat' ? `Rs. ${v.toLocaleString('en-US')} off` : `${v}% off`;
};

/** Manage the tenant's bank cards used by card-linked discounts (e.g. "HBL Premium Debit"). */
const BankCards: React.FC = () => {
  const queryClient = useQueryClient();
  const canCreatePerm = useHasPermission('bank-cards:create');
  const canEditPerm = useHasPermission('bank-cards:edit');
  const canDeletePerm = useHasPermission('bank-cards:delete');
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const { user } = useAuth();
  const allowedBrandIds = user?.allowed_brand_ids ?? null;

  const { data: cards, isLoading } = useQuery({
    queryKey: ['bank-cards'],
    queryFn: () => adminService.getBankCards(false),
  });
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const res = await apiClient.get<Array<{ id: number; name: string }>>('/admin/brands');
      return res.data;
    },
  });

  const brandOptions: SearchableMultiSelectOption[] = (brands ?? []).map((b) => ({ id: b.id, name: b.name }));
  const brandNameById = useMemo(
    () => new Map((brands ?? []).map((b) => [b.id, b.name])),
    [brands],
  );

  // The validity block is meaningless until the card actually discounts something.
  const hasOffer = form.discount_value !== '' && Number(form.discount_value) > 0;

  const close = () => {
    setShowForm(false);
    setForm(emptyForm);
    setEditingId(null);
  };

  const openAdd = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        bank: form.bank.trim() || null,
        network: form.network.trim() || null,
        bin_prefixes: parseBins(form.bin).length ? parseBins(form.bin) : null,
        eligibility_brand_ids: form.eligibility_brand_ids,
        discount_type: form.discount_value === '' ? null : form.discount_type,
        discount_value: form.discount_value === '' ? null : Number(form.discount_value),
        min_order_amount: form.min_order_amount === '' ? null : Number(form.min_order_amount),
        max_discount_amount:
          form.max_discount_amount === '' || form.discount_type === 'flat'
            ? null
            : Number(form.max_discount_amount),
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
        valid_time_start: form.valid_time_start || null,
        valid_time_end: form.valid_time_end || null,
        valid_days_of_week: form.valid_days_of_week,
        is_active: form.is_active,
      };
      return editingId != null
        ? adminService.updateBankCard(editingId, payload)
        : adminService.createBankCard(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-cards'] });
      toast.success(editingId != null ? 'Bank card updated' : 'Bank card added');
      close();
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
    setShowForm(true);
    setForm({
      name: c.name,
      bank: c.bank ?? '',
      network: c.network ?? '',
      bin: (c.bin_prefixes ?? []).join(', '),
      eligibility_brand_ids: c.eligibility_brand_ids ?? [],
      discount_type: c.discount_type === 'flat' ? 'flat' : 'percentage',
      discount_value: c.discount_value ?? '',
      min_order_amount: c.min_order_amount ?? '',
      max_discount_amount: c.max_discount_amount ?? '',
      is_active: c.is_active,
      valid_from: c.valid_from ? c.valid_from.slice(0, 10) : '',
      valid_until: c.valid_until ? c.valid_until.slice(0, 10) : '',
      valid_time_start: c.valid_time_start ?? '',
      valid_time_end: c.valid_time_end ?? '',
      valid_days_of_week: c.valid_days_of_week ?? [],
    });
  };

  const list = (cards ?? []) as Card[];
  const activeCount = list.filter((c) => c.is_active).length;

  const submit = () => {
    if (!form.name.trim()) {
      toast.error('Card name is required');
      return;
    }
    saveMutation.mutate();
  };

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-12">
      {/* Header */}
      <div className="mb-[22px] flex flex-wrap items-start gap-4">
        <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl bg-red-50 text-red-600">
          <MdCreditCard size={24} />
        </span>
        <div className="min-w-[280px] flex-1">
          <h1 className="mb-1.5 text-2xl font-extrabold tracking-tight text-gray-800 sm:text-[28px]">Bank Cards</h1>
          <p className="max-w-[700px] text-[14px] leading-relaxed text-gray-500">
            Add a card, then set what a customer gets for paying with it. The discount applies only when the{' '}
            <span className="font-semibold text-gray-700">whole bill</span> is paid with that card — a cash + card split earns nothing. See how each offer is performing under{' '}
            <span className="font-semibold text-gray-700">Reports → Discounts</span>.
          </p>
        </div>
        {canCreatePerm && <button
          type="button"
          onClick={openAdd}
          className="inline-flex flex-none items-center gap-2 rounded-[11px] bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 active:scale-[0.98]"
        >
          <span className="text-lg leading-none">+</span>Add a card
        </button>}
      </div>

      {/* BIN lookup: with hundreds of cards, answer "does THIS card have a
          discount?" from the first digits of the customer's card. */}
      <div className="mb-6">
        <BankCardBinLookup />
      </div>

      {/* List */}
      <div className="mb-3.5 flex items-center justify-between">
        <span className="text-[12px] font-bold uppercase tracking-wider text-gray-400">Linked cards · {list.length}</span>
        <span className="text-[12.5px] text-gray-400">{activeCount} active</span>
      </div>
      {isLoading ? (
        <div className="py-12 text-center text-gray-500">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-3">
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
                    {canEditPerm && canEdit(c.manage_scope) && (
                      <button type="button" onClick={() => startEdit(c)} title="Edit" className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-white/[0.14] text-white transition-colors hover:bg-white/25">
                        <MdEdit size={15} />
                      </button>
                    )}
                    {canDeletePerm && c.manage_scope !== 'read_only' && (
                      <button type="button" onClick={async () => { if (await confirmDialog(removeDialog(c.manage_scope, 'card', c.name))) deleteMutation.mutate(c.id); }} title={removeLabel(c.manage_scope)} className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-white/[0.14] text-red-200 transition-colors hover:bg-red-500/60">
                        <MdDelete size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <div className="relative">
                <div className="mb-3.5">
                  <div className="flex flex-wrap items-center gap-2 text-[19px] font-bold tracking-tight text-white">
                    {c.name}
                    <BrandScopeBadge effectiveBrandIds={c.effective_brand_ids} brandNameById={brandNameById} allowedBrandIds={allowedBrandIds} />
                  </div>
                  {/* The shared notice is styled for light rows; lift it off the dark card face. */}
                  <div className="[&>p]:mt-1 [&>p]:text-white/60">
                    <BrandScopeNotice manageScope={c.manage_scope} noun="card" />
                  </div>
                </div>
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
                {discountText(c) && (
                  <div className="mt-[11px] border-t border-white/[0.14] pt-[11px] text-[12px] font-bold text-[#FBD98A]">
                    {discountText(c)}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Add-another tile */}
          {canCreatePerm && <button
            type="button"
            onClick={openAdd}
            className="flex min-h-[186px] flex-col items-center justify-center gap-2.5 rounded-2xl border-[1.5px] border-dashed border-gray-300 bg-gray-50 text-gray-400 transition-colors hover:border-red-500 hover:text-red-600"
          >
            <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full border-[1.5px] border-current bg-white text-[22px] font-light leading-none">+</span>
            <span className="text-[13.5px] font-semibold">Add another card</span>
          </button>}
        </div>
      )}

      {/* Add / edit card */}
      <OfferModal
        open={showForm}
        onClose={close}
        title={editingId != null ? 'Edit card' : 'Add a card'}
        width={640}
        autoHeight
        icon={<MdAddCard size={18} />}
        footer={
          <>
            <div />
            <div className="flex gap-3">
              <button type="button" onClick={close} className="rounded-[11px] border-[1.5px] border-gray-300 bg-white px-5 py-[11px] text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={submit} disabled={saveMutation.isPending} className="rounded-[11px] bg-red-600 px-6 py-[11px] text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 active:scale-[0.97] disabled:opacity-60">
                {editingId != null ? 'Save changes' : 'Add card'}
              </button>
            </div>
          </>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col gap-[17px] overflow-y-auto px-[26px] py-[22px]">
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
          {allowedBrandIds == null && (
            <div>
              <SearchableMultiSelect
                options={brandOptions}
                selectedIds={form.eligibility_brand_ids}
                onChange={(ids) => setForm({ ...form, eligibility_brand_ids: ids })}
                placeholder="All brands"
                label="Brands"
                maxHeight="12rem"
              />
              <p className="mt-2 text-[12px] leading-snug text-gray-400">Leave empty to make this card available to all brands.</p>
            </div>
          )}
          <div className="h-px bg-gray-100" />

          <div>
            <div className="text-[13px] font-semibold text-gray-700">Discount</div>
            <p className="mb-3 mt-0.5 text-[12px] leading-snug text-gray-400">
              What the customer gets for paying with this card. Leave the value empty for a card you only want to record at the till.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={offerLabel}>Type</label>
                <select value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value as 'flat' | 'percentage' })} className={offerInput}>
                  <option value="percentage">Percentage</option>
                  <option value="flat">Flat Amount</option>
                </select>
              </div>
              <div>
                <label className={offerLabel}>Value</label>
                <input type="number" min={0} value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value === '' ? '' : Number(e.target.value) })} className={offerInput} placeholder="none" />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className={offerLabel}>Min order (Rs)</label>
                <input type="number" min={0} value={form.min_order_amount} onChange={(e) => setForm({ ...form, min_order_amount: e.target.value === '' ? '' : Number(e.target.value) })} className={offerInput} placeholder="none" />
              </div>
              <div>
                <label className={offerLabel}>Max discount (Rs)</label>
                <input type="number" min={0} value={form.max_discount_amount} onChange={(e) => setForm({ ...form, max_discount_amount: e.target.value === '' ? '' : Number(e.target.value) })} className={offerInput} placeholder="none" disabled={form.discount_type === 'flat'} />
              </div>
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-snug text-gray-400">
              <MdInfoOutline size={14} className="mt-px shrink-0" />
              Only applies when the <span className="font-semibold text-gray-500">whole bill</span> is paid with this card.
            </p>
          </div>

          {hasOffer && (
            <div>
              <div className="text-[13px] font-semibold text-gray-700">Valid when</div>
              <p className="mb-3 mt-0.5 text-[12px] text-gray-400">Leave empty to run with no time limit.</p>
              <ValidityFields
                value={{
                  valid_from: form.valid_from,
                  valid_until: form.valid_until,
                  valid_time_start: form.valid_time_start,
                  valid_time_end: form.valid_time_end,
                  valid_days_of_week: form.valid_days_of_week,
                }}
                onChange={(v) => setForm({ ...form, ...v })}
              />
            </div>
          )}

          <div className="flex items-center justify-between rounded-[11px] border border-gray-100 bg-gray-50 px-3.5 py-3">
            <div>
              <div className="text-[13.5px] font-semibold text-gray-700">Active</div>
              <div className="text-[12px] text-gray-400">Selectable at the till; its discount runs</div>
            </div>
            <SegToggle on={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} ariaLabel="Active" />
          </div>
        </div>
      </OfferModal>
    </div>
  );
};

export default BankCards;
