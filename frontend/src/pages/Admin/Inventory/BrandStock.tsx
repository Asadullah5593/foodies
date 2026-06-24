import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LuSearch, LuPackage } from 'react-icons/lu';
import apiClient from '../../../utils/apiClient';
import Loader from '../../../components/Loader';
import { inventoryService } from '../../../services/api/inventoryService';

const card =
  'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm';
const field =
  'w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400';

const fmt = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');

/**
 * "My brand stock" — a brand admin's view of their brand's on-hand stock across
 * all the branches they're assigned to. Items are rows; branches are columns.
 * Server-side, the data is scoped to the caller's brand + branches.
 */
const BrandStock: React.FC = () => {
  const [search, setSearch] = useState('');
  const [brandId, setBrandId] = useState<number | null>(null);

  const brandsQ = useQuery({
    queryKey: ['brands'],
    queryFn: async () => (await apiClient.get('/admin/brands')).data ?? [],
  });
  const uomsQ = useQuery({
    queryKey: ['transfer-ref-uoms'],
    queryFn: inventoryService.listTransferReferenceUoms,
  });

  // Default to the first (for a brand admin this is their only) brand.
  const activeBrandId = brandId ?? Number((brandsQ.data ?? [])[0]?.id) ?? null;

  const onHandQ = useQuery({
    queryKey: ['brand-on-hand', activeBrandId],
    queryFn: () => inventoryService.getBrandOnHand(activeBrandId as number),
    enabled: activeBrandId != null,
  });

  const uomById = useMemo(() => {
    const m = new Map<number, any>();
    for (const u of uomsQ.data ?? []) m.set(Number(u.id), u);
    return m;
  }, [uomsQ.data]);

  const branches = onHandQ.data?.branches ?? [];
  const items = useMemo(() => {
    const all = onHandQ.data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (it) =>
        it.item_name.toLowerCase().includes(q) ||
        it.item_code.toLowerCase().includes(q),
    );
  }, [onHandQ.data, search]);

  const loading = brandsQ.isLoading || onHandQ.isLoading;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            My brand stock
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            On-hand stock for your brand across every branch you manage.
          </p>
        </div>
        {(brandsQ.data ?? []).length > 1 && (
          <select
            className={`${field} w-auto`}
            value={activeBrandId ?? ''}
            onChange={(e) => setBrandId(Number(e.target.value))}
          >
            {(brandsQ.data ?? []).map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="relative max-w-sm">
        <LuSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className={`${field} pl-9`}
          placeholder="Search item by name or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className={`${card} p-0`}>
        {loading ? (
          <div className="p-8">
            <Loader />
          </div>
        ) : activeBrandId == null ? (
          <div className="p-10 text-center text-slate-400">
            No brand available.
          </div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-slate-400">
            <LuPackage className="w-8 h-8 mx-auto mb-2 opacity-50" />
            No stock found for this brand in your branches.
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-2.5 px-4 font-medium">Item</th>
                  {branches.map((b) => (
                    <th key={b.branch_id} className="py-2.5 px-4 font-medium text-right">
                      {b.branch_name}
                    </th>
                  ))}
                  <th className="py-2.5 px-4 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="text-slate-700 dark:text-slate-200">
                {items.map((it) => {
                  const uom =
                    it.base_uom_id != null
                      ? uomById.get(Number(it.base_uom_id))?.code ?? ''
                      : '';
                  return (
                    <tr
                      key={it.inventory_item_id}
                      className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50/60 dark:hover:bg-slate-700/30"
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {it.item_name}
                        </div>
                        <div className="text-xs text-slate-400">{it.item_code}</div>
                      </td>
                      {branches.map((b) => {
                        const qty = it.by_branch[b.branch_id];
                        return (
                          <td
                            key={b.branch_id}
                            className={`py-3 px-4 text-right tabular-nums ${
                              qty != null && qty < 0 ? 'text-red-600 font-semibold' : ''
                            }`}
                          >
                            {qty != null ? fmt(qty) : '—'}
                          </td>
                        );
                      })}
                      <td className="py-3 px-4 text-right font-semibold tabular-nums">
                        {fmt(it.total_qty)} {uom}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default BrandStock;
