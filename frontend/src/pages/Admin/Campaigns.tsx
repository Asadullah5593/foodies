import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { Campaign, CampaignItem, Discount, OfferReport } from '../../types';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import OfferModal, { offerInput, offerLabel } from '../../components/OfferModal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { OFFER_KIND_LABEL } from '../../utils/offerKinds';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import SearchableSelect from '../../components/SearchableSelect';
import ValidityFields, { emptyValidity } from '../../components/ValidityFields';
import { confirmDialog } from '../../utils/sweetAlert';

const emptyCampaign = { name: '', description: '', is_active: true, ...emptyValidity };
const emptyItem = {
  kind: 'info' as 'info' | 'offer' | 'deal',
  title: '', subtitle: '', image_url: '',
  offer_id: '' as number | '',
  deal_menu_item_id: '' as number | '',
  destination_type: 'none' as string,
  destination_id: '' as number | '',
  is_active: true,
};

const DEST_TYPES = ['none', 'product', 'deal', 'category', 'brand', 'branch'];
// Campaign-only kinds, plus the four offer kinds from their shared source.
const KIND_LABEL: Record<string, string> = { offer: 'Offer', deal: 'Deal', info: 'Info banner', ...OFFER_KIND_LABEL };
const KIND_BADGE: Record<string, string> = { offer: 'bg-purple-100 text-purple-700', deal: 'bg-amber-100 text-amber-700', info: 'bg-sky-100 text-sky-700' };

type Opt = { value: string; label: string };

const Campaigns: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [form, setForm] = useState({ ...emptyCampaign });
  const [itemsFor, setItemsFor] = useState<Campaign | null>(null);
  const [reportFor, setReportFor] = useState<Campaign | null>(null);
  const [itemForm, setItemForm] = useState({ ...emptyItem });
  const [uploading, setUploading] = useState(false);

  const { data: campaigns, isLoading } = useQuery({ queryKey: ['campaigns'], queryFn: adminService.getCampaigns });
  const { data: discounts } = useQuery({ queryKey: ['discounts'], queryFn: adminService.getDiscounts });
  const { data: promos } = useQuery({ queryKey: ['product-promotions'], queryFn: adminService.getProductPromotions });
  const { data: coupons } = useQuery({ queryKey: ['coupons'], queryFn: adminService.getCoupons });
  const { data: deals } = useQuery({ queryKey: ['deals-all'], queryFn: () => adminService.getDeals() });
  const { data: menuItems } = useQuery({ queryKey: ['menu-items-all'], queryFn: () => adminService.getMenuItems() });
  const { data: categories } = useQuery({ queryKey: ['categories-all'], queryFn: () => adminService.getCategories() });
  const { data: brands } = useQuery({ queryKey: ['brands'], queryFn: adminService.getBrands });
  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: async () => (await apiClient.get<{ id: number; name: string }[]>('/admin/branches')).data });
  const { data: items } = useQuery<CampaignItem[]>({ queryKey: ['campaign-items', itemsFor?.id], queryFn: () => adminService.getCampaignItems(itemsFor!.id), enabled: itemsFor != null });
  const { data: report } = useQuery<OfferReport>({ queryKey: ['campaign-report', reportFor?.id], queryFn: () => adminService.getCampaignReport(reportFor!.id), enabled: reportFor != null });

  const list = campaigns ?? [];
  const allOffers: Discount[] = [...(discounts ?? []), ...(promos ?? []), ...(coupons ?? [])];
  const asOpts = (arr: unknown, idKey = 'id'): Opt[] =>
    ((arr as Record<string, unknown>[] | undefined) ?? [])
      .map((x) => ({ value: String((x[idKey] ?? x['menu_item_id']) as number), label: String(x['name']) }))
      .filter((o) => o.value !== 'undefined');
  const dealOpts = asOpts(deals);
  const productOpts = asOpts(menuItems);
  const categoryOpts = asOpts(categories);
  const brandOpts = asOpts(brands);
  const branchOpts = asOpts(branches);
  const offerOpts: Opt[] = allOffers.map((o) => ({ value: String(o.id), label: `[${KIND_LABEL[o.offer_kind ?? 'discount'] ?? o.offer_kind}] ${o.name}` }));
  const destOptionsFor = (t: string): Opt[] =>
    t === 'product' ? productOpts : t === 'deal' ? dealOpts : t === 'category' ? categoryOpts : t === 'brand' ? brandOpts : t === 'branch' ? branchOpts : [];

  const paginated = useMemo(() => list.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE), [list, page]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['campaigns'] });
  const invalidateItems = () => queryClient.invalidateQueries({ queryKey: ['campaign-items', itemsFor?.id] });
  const onErr = (e: { response?: { data?: { message?: string } } }) => toast.error(e.response?.data?.message || 'Failed');

  const createM = useMutation({ mutationFn: adminService.createCampaign, onSuccess: () => { invalidate(); setShowForm(false); setForm({ ...emptyCampaign }); toast.success('Campaign created'); }, onError: onErr });
  const updateM = useMutation({ mutationFn: ({ id, data }: { id: number; data: Partial<Campaign> }) => adminService.updateCampaign(id, data), onSuccess: () => { invalidate(); setShowForm(false); setEditing(null); toast.success('Updated'); }, onError: onErr });
  const deleteM = useMutation({ mutationFn: adminService.deleteCampaign, onSuccess: () => { invalidate(); toast.success('Deleted'); }, onError: onErr });
  const addItemM = useMutation({ mutationFn: ({ id, data }: { id: number; data: Partial<CampaignItem> }) => adminService.createCampaignItem(id, data), onSuccess: () => { invalidateItems(); setItemForm({ ...emptyItem }); toast.success('Banner added'); }, onError: onErr });
  const delItemM = useMutation({ mutationFn: ({ id, itemId }: { id: number; itemId: number }) => adminService.deleteCampaignItem(id, itemId), onSuccess: () => { invalidateItems(); toast.success('Removed'); }, onError: onErr });

  const uploadItemImage = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('folder', 'banners');
      const { data } = await apiClient.post<{ url: string }>('/admin/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setItemForm((f) => ({ ...f, image_url: data.url }));
      toast.success('Image uploaded');
    } catch { toast.error('Upload failed'); } finally { setUploading(false); }
  };

  const pickOffer = (offerId: number | '') => {
    const o = allOffers.find((x) => x.id === offerId);
    let dt = 'none'; let di: number | '' = '';
    if (o) {
      if (o.application_scope === 'category' && o.application_scope_ids?.length) { dt = 'category'; di = o.application_scope_ids[0]; }
      else if (o.application_scope === 'products' && o.application_scope_ids?.length) { dt = 'product'; di = o.application_scope_ids[0]; }
    }
    setItemForm((f) => ({ ...f, offer_id: offerId, destination_type: dt, destination_id: di }));
  };
  const pickDeal = (dealId: number | '') =>
    setItemForm((f) => ({ ...f, deal_menu_item_id: dealId, destination_type: dealId === '' ? 'none' : 'deal', destination_id: dealId }));

  const handleEdit = (c: Campaign) => {
    setEditing(c);
    setForm({
      name: c.name, description: c.description ?? '', is_active: c.is_active,
      valid_from: c.valid_from ? c.valid_from.slice(0, 10) : '',
      valid_until: c.valid_until ? c.valid_until.slice(0, 10) : '',
      valid_time_start: '', valid_time_end: '', valid_days_of_week: [],
    });
    setShowForm(true);
  };

  const submitCampaign = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Partial<Campaign> = {
      name: form.name, description: form.description || null,
      valid_from: form.valid_from || null, valid_until: form.valid_until || null, is_active: form.is_active,
    };
    if (editing) updateM.mutate({ id: editing.id, data }); else createM.mutate(data);
  };

  const submitItem = () => {
    if (!itemsFor) return;
    if (itemForm.kind === 'offer' && !itemForm.offer_id) { toast.error('Pick an offer'); return; }
    if (itemForm.kind === 'deal' && !itemForm.deal_menu_item_id) { toast.error('Pick a deal'); return; }
    if (itemForm.kind === 'info' && !itemForm.image_url && !itemForm.title) { toast.error('Add a title or image for the banner'); return; }
    addItemM.mutate({
      id: itemsFor.id,
      data: {
        kind: itemForm.kind,
        title: itemForm.title || null,
        subtitle: itemForm.subtitle || null,
        image_url: itemForm.image_url || null,
        offer_id: itemForm.kind === 'offer' ? Number(itemForm.offer_id) : null,
        deal_menu_item_id: itemForm.kind === 'deal' ? Number(itemForm.deal_menu_item_id) : null,
        destination_type: itemForm.destination_type,
        destination_id: itemForm.destination_id === '' ? null : Number(itemForm.destination_id),
        is_active: itemForm.is_active,
      },
    });
  };

  const destLabel = (t?: string | null, id?: number | null): string => {
    if (!t || t === 'none' || id == null) return '';
    const opt = destOptionsFor(t).find((o) => o.value === String(id));
    return opt ? `${t}: ${opt.label}` : `${t} #${id}`;
  };

  if (isLoading) return <Loader fullScreen text="Loading campaigns..." />;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Campaigns</h1>
        <Button onClick={() => { setEditing(null); setForm({ ...emptyCampaign }); setShowForm(true); }}>Add Campaign</Button>
      </div>

      {/* Campaign form — no image here; images live on each banner */}
      <Modal isOpen={showForm} onClose={() => { setShowForm(false); setEditing(null); }} title={editing ? 'Edit Campaign' : 'Create Campaign'} size="large">
        <form onSubmit={submitCampaign} className="space-y-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input type="text" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-4 py-2 border border-gray-300 rounded-lg" /></div>
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Runs (required)</h3>
            <ValidityFields
              datesOnly
              requireDates
              value={{ valid_from: form.valid_from, valid_until: form.valid_until, valid_time_start: '', valid_time_end: '', valid_days_of_week: [] }}
              onChange={(v) => setForm({ ...form, valid_from: v.valid_from, valid_until: v.valid_until })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active</label>
          <p className="text-xs text-gray-500">A campaign is a container. Add <span className="font-medium">banners</span> (with their own images) inside it via "Banners".</p>
          <div className="flex gap-2 justify-end border-t pt-4">
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditing(null); }}>Cancel</Button>
            <Button type="submit" isLoading={createM.isPending || updateM.isPending}>{editing ? 'Update' : 'Create'}</Button>
          </div>
        </form>
      </Modal>

      {/* Banners editor */}
      <OfferModal
        open={itemsFor != null}
        onClose={() => setItemsFor(null)}
        title={`Banners — ${itemsFor?.name ?? ''}`}
        subtitle="In-app promotional banners for this campaign"
        width={1040}
        icon={
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <rect x="2.5" y="4" width="15" height="12" rx="2" /><path d="M2.5 12l4-3.5 4 3 3-2.5 4 3" /><circle cx="7" cy="8" r="1.2" />
          </svg>
        }
      >
        <div className="flex min-h-0 flex-1">
          {/* Left: add a banner */}
          <div className="w-[480px] flex-none overflow-y-auto border-r border-gray-100 px-6 py-5">
            <div className="mb-4 text-[15px] font-bold text-gray-800">Add a banner</div>

            <label className={offerLabel}>Type</label>
            <div className="mb-1.5 grid grid-cols-3 gap-2">
              {(['info', 'offer', 'deal'] as const).map((k) => {
                const on = itemForm.kind === k;
                return (
                  <button key={k} type="button"
                    onClick={() => setItemForm({ ...emptyItem, kind: k, title: itemForm.title, subtitle: itemForm.subtitle, image_url: itemForm.image_url })}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border-[1.5px] px-2 py-3 transition-colors ${on ? 'border-red-600 bg-red-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                    <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${on ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                        {k === 'info' ? (
                          <><circle cx="9" cy="9" r="7" /><line x1="9" y1="8" x2="9" y2="13" /><circle cx="9" cy="5.5" r="0.6" fill="currentColor" stroke="none" /></>
                        ) : k === 'offer' ? (
                          <><path d="M3 8V4a1 1 0 0 1 1-1h4l7 7-5 5-7-7z" /><circle cx="6" cy="6" r="1.1" /></>
                        ) : (
                          <path d="M9 2l2 4 4.5.5-3.3 3 .9 4.5L9 12l-4 2 .9-4.5L2.5 6.5 7 6z" />
                        )}
                      </svg>
                    </span>
                    <span className={`text-[13px] font-semibold ${on ? 'text-red-700' : 'text-gray-700'}`}>{KIND_LABEL[k]}</span>
                  </button>
                );
              })}
            </div>
            <p className="mb-4 text-[12px] leading-relaxed text-gray-400">
              {itemForm.kind === 'info' ? 'Just an image + text (no offer, no destination).'
                : itemForm.kind === 'offer' ? 'Promotes a discount / product promotion / coupon; tapping opens the offer.'
                : 'Promotes a combo deal; tapping opens the deal.'}
            </p>

            <div className="mb-4 grid grid-cols-2 gap-3">
              <div><label className={offerLabel}>Title</label><input type="text" placeholder="Title" value={itemForm.title} onChange={(e) => setItemForm({ ...itemForm, title: e.target.value })} className={offerInput} /></div>
              <div><label className={offerLabel}>Subtitle</label><input type="text" placeholder="Subtitle" value={itemForm.subtitle} onChange={(e) => setItemForm({ ...itemForm, subtitle: e.target.value })} className={offerInput} /></div>
            </div>

            {itemForm.kind === 'offer' && (
              <div className="mb-4">
                <SearchableSelect
                  label="Offer to advertise *"
                  value={itemForm.offer_id === '' ? '' : String(itemForm.offer_id)}
                  onChange={(v) => pickOffer(v === '' ? '' : Number(v))}
                  options={offerOpts}
                  placeholder="Search an offer…"
                  searchPlaceholder="Search offers…"
                />
              </div>
            )}
            {itemForm.kind === 'deal' && (
              <div className="mb-4">
                <SearchableSelect
                  label="Deal to advertise *"
                  value={itemForm.deal_menu_item_id === '' ? '' : String(itemForm.deal_menu_item_id)}
                  onChange={(v) => pickDeal(v === '' ? '' : Number(v))}
                  options={dealOpts}
                  placeholder="Search a deal…"
                  searchPlaceholder="Search deals…"
                />
              </div>
            )}

            <div className="mb-4">
              <label className={offerLabel}>Tapping the banner opens</label>
              <div className="grid grid-cols-2 items-start gap-2.5">
                <select value={itemForm.destination_type}
                  onChange={(e) => setItemForm({ ...itemForm, destination_type: e.target.value, destination_id: '' })}
                  className={offerInput}>
                  {DEST_TYPES.map((d) => <option key={d} value={d}>{d === 'none' ? 'Nothing (view only)' : d}</option>)}
                </select>
                {itemForm.destination_type !== 'none' ? (
                  <SearchableSelect
                    value={itemForm.destination_id === '' ? '' : String(itemForm.destination_id)}
                    onChange={(v) => setItemForm({ ...itemForm, destination_id: v === '' ? '' : Number(v) })}
                    options={destOptionsFor(itemForm.destination_type)}
                    placeholder={`Pick a ${itemForm.destination_type}…`}
                    searchPlaceholder="Search…"
                  />
                ) : <div className="self-center text-[12.5px] text-gray-400">No navigation</div>}
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-gray-400">Auto-filled from the offer/deal above; change it here (by name, no IDs). A shareable deep link is generated automatically.</p>
            </div>

            <div className="mb-5">
              <label className={offerLabel}>Banner image</label>
              <input type="file" accept="image/*" id="item-image" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadItemImage(f); }} />
              <button type="button" onClick={() => document.getElementById('item-image')?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border-[1.5px] border-dashed border-gray-300 bg-gray-50 px-5 py-5 transition-colors hover:border-red-500">
                {itemForm.image_url ? (
                  <img src={itemForm.image_url} alt="" className="h-16 w-full max-w-[220px] rounded-lg object-cover" />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-gray-100 text-gray-400">
                    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M10 13V4M10 4L6.5 7.5M10 4l3.5 3.5" /><path d="M3.5 12.5v3a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-3" /></svg>
                  </span>
                )}
                <span className="text-center">
                  <span className="block text-[13px] font-semibold text-gray-700">{uploading ? 'Uploading…' : itemForm.image_url ? 'Change image' : 'Upload image'}</span>
                  <span className="mt-0.5 block text-[11.5px] text-gray-400">PNG or JPG · 3:1 recommended</span>
                </span>
              </button>
            </div>

            <button type="button" onClick={submitItem} disabled={addItemM.isPending}
              className="rounded-[11px] bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 active:scale-[0.98] disabled:opacity-60">+ Add banner</button>
          </div>

          {/* Right: banner list */}
          <div className="flex min-w-0 flex-1 flex-col bg-gray-50">
            <div className="flex flex-none items-center gap-2.5 px-6 pb-3 pt-5">
              <span className="text-[15px] font-bold text-gray-800">Banners in this campaign</span>
              <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[12.5px] font-bold text-red-600">{items?.length ?? 0}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-5">
              {(items ?? []).map((it) => (
                <div key={it.id} className="flex gap-3.5 rounded-2xl border border-gray-200 bg-white p-3.5 shadow-sm">
                  {it.image_url
                    ? <img src={it.image_url} alt="" className="h-16 w-24 flex-none rounded-[9px] object-cover" />
                    : <div className="flex h-16 w-24 flex-none items-center justify-center rounded-[9px] bg-gradient-to-br from-slate-500 to-slate-700 text-[10px] font-bold uppercase tracking-wide text-white/80">Image</div>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2.5">
                      <span className={`rounded-full px-2.5 py-[3px] text-[10.5px] font-bold uppercase tracking-wide ${KIND_BADGE[it.kind]}`}>{KIND_LABEL[it.kind]}</span>
                      <button type="button" onClick={() => itemsFor && delItemM.mutate({ id: itemsFor.id, itemId: it.id })}
                        className="rounded-lg border-none bg-red-50 px-3 py-1.5 text-[12.5px] font-semibold text-red-600 transition-colors hover:bg-red-100">Remove</button>
                    </div>
                    <div className="mt-1.5 truncate text-[14.5px] font-bold text-gray-800">{it.title || '(untitled)'}</div>
                    {it.subtitle && <div className="truncate text-[12.5px] text-gray-400">{it.subtitle}</div>}
                    {it.deep_link_url && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#9AA1AD" strokeWidth={1.6} strokeLinecap="round"><path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1" /><path d="M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1" /></svg>
                        <a href={it.deep_link_url} target="_blank" rel="noreferrer" className="max-w-[210px] truncate text-[12px] text-blue-500 hover:underline">{it.deep_link_url}</a>
                        <button type="button" onClick={() => { navigator.clipboard?.writeText(it.deep_link_url!); toast.success('Deep link copied'); }} className="flex-none text-[11.5px] font-semibold text-gray-400 hover:text-red-600">copy</button>
                      </div>
                    )}
                    {!it.deep_link_url && destLabel(it.destination_type, it.destination_id) && (
                      <div className="mt-1.5 text-[11px] text-gray-400">→ {destLabel(it.destination_type, it.destination_id)}</div>
                    )}
                  </div>
                </div>
              ))}
              {(items?.length ?? 0) === 0 && <p className="rounded-xl border border-dashed border-gray-200 bg-white px-3 py-12 text-center text-sm text-gray-400">No banners yet — add one on the left.</p>}
            </div>
          </div>
        </div>
      </OfferModal>

      {/* Report */}
      <Modal isOpen={reportFor != null} onClose={() => setReportFor(null)} title={`Report — ${reportFor?.name ?? ''}`} size="large">
        {report ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-green-50 dark:bg-slate-800 p-4 text-center"><div className="text-2xl font-bold text-green-700">{report.redemptions ?? 0}</div><div className="text-xs text-gray-500">Redemptions</div></div>
              <div className="rounded-xl bg-blue-50 dark:bg-slate-800 p-4 text-center"><div className="text-2xl font-bold text-blue-700">Rs {report.total_value ?? 0}</div><div className="text-xs text-gray-500">Total value</div></div>
              <div className="rounded-xl bg-indigo-50 dark:bg-slate-800 p-4 text-center"><div className="text-2xl font-bold text-indigo-700">Rs {report.merchant_funded ?? 0}</div><div className="text-xs text-gray-500">Merchant-funded</div></div>
              <div className="rounded-xl bg-teal-50 dark:bg-slate-800 p-4 text-center"><div className="text-2xl font-bold text-teal-700">Rs {report.bank_funded ?? 0}</div><div className="text-xs text-gray-500">Bank-funded</div></div>
            </div>
            <p className="text-xs text-gray-400">Value the campaign's linked offers gave away (merchant-funded = your cost; bank-funded = subsidised by the card issuer).</p>
          </div>
        ) : <Loader text="Loading…" />}
      </Modal>

      <div className="w-full space-y-3">
        {list.length === 0 ? (
          <Card><p className="text-center text-gray-500 py-12">No campaigns yet.</p></Card>
        ) : (
          <>
            <AccentedList>
              {paginated.map((c, i) => (
                <AccentedListRow
                  key={c.id}
                  accent={c.is_active ? 'active' : 'inactive'}
                  initial={c.name.charAt(0)}
                  title={c.name}
                  subtitle={<p className="text-gray-500 text-xs">{c.item_count ?? 0} banner(s){c.description ? ` · ${c.description}` : ''}</p>}
                  statusLabel={c.is_active ? 'Active' : 'Inactive'}
                  statusVariant={c.is_active ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      <Button size="small" variant="outline" onClick={() => { setItemsFor(c); setItemForm({ ...emptyItem }); }}>Banners</Button>
                      <Button size="small" variant="outline" onClick={() => setReportFor(c)}>Report</Button>
                      <Button size="small" variant="edit" onClick={() => handleEdit(c)}>Edit</Button>
                      <Button size="small" variant="danger" onClick={async () => { if (await confirmDialog({ title: `Delete "${c.name}"?`, confirmText: 'Delete' })) deleteM.mutate(c.id); }}>Delete</Button>
                    </>
                  }
                />
              ))}
            </AccentedList>
            <PaginationBar totalCount={list.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="campaigns" />
          </>
        )}
      </div>
    </div>
  );
};

export default Campaigns;
