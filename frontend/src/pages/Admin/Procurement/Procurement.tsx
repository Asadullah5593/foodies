import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Card from '../../../components/Card';
import Loader from '../../../components/Loader';
import Button from '../../../components/Button';
import apiClient from '../../../utils/apiClient';
import { inventoryService } from '../../../services/api/inventoryService';
import { procurementService } from '../../../services/api/procurementService';

export type ProcurementTabKey = 'prs' | 'pos' | 'grns';

const Procurement: React.FC<{ initialTab?: ProcurementTabKey; showTabs?: boolean }> = ({
  initialTab = 'prs',
  showTabs = true,
}) => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ProcurementTabKey>(initialTab);
  const [form, setForm] = useState<any>({});

  const branchesQ = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await apiClient.get('/admin/branches')).data ?? [],
  });
  const vendorsQ = useQuery({
    queryKey: ['inventory-vendors'],
    queryFn: inventoryService.listVendors,
  });
  const itemsQ = useQuery({
    queryKey: ['inventory-items'],
    queryFn: inventoryService.listItems,
  });
  const uomsQ = useQuery({
    queryKey: ['inventory-uoms'],
    queryFn: inventoryService.listUoms,
  });

  const prsQ = useQuery({
    queryKey: ['procurement-prs'],
    queryFn: procurementService.listPRs,
    enabled: tab === 'prs',
  });
  const posQ = useQuery({
    queryKey: ['procurement-pos'],
    queryFn: procurementService.listPOs,
    enabled: tab === 'pos',
  });
  const grnsQ = useQuery({
    queryKey: ['procurement-grns'],
    queryFn: procurementService.listGRNs,
    enabled: tab === 'grns',
  });

  const createPRM = useMutation({
    mutationFn: procurementService.createPR,
    onSuccess: async () => {
      toast.success('PR created');
      await queryClient.invalidateQueries({ queryKey: ['procurement-prs'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create PR'),
  });

  const submitPRM = useMutation({
    mutationFn: (id: number) => procurementService.submitPR(id),
    onSuccess: async () => {
      toast.success('PR submitted');
      await queryClient.invalidateQueries({ queryKey: ['procurement-prs'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to submit PR'),
  });

  const approvePRM = useMutation({
    mutationFn: (id: number) => procurementService.approvePR(id, {}),
    onSuccess: async () => {
      toast.success('PR approved → PO created');
      await queryClient.invalidateQueries({ queryKey: ['procurement-prs'] });
      await queryClient.invalidateQueries({ queryKey: ['procurement-pos'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to approve PR'),
  });

  const createGRNM = useMutation({
    mutationFn: (data: { purchase_order_id: number; branch_id: number; notes?: string }) => procurementService.createGRN(data),
    onSuccess: async () => {
      toast.success('GRN created');
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create GRN'),
  });

  const postGRNM = useMutation({
    mutationFn: (id: number) => procurementService.postGRN(id),
    onSuccess: async () => {
      toast.success('GRN posted');
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to post GRN'),
  });

  const reverseGRNM = useMutation({
    mutationFn: (id: number) => procurementService.reverseGRN(id),
    onSuccess: async () => {
      toast.success('GRN reversed');
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to reverse GRN'),
  });

  const addGRNLineM = useMutation({
    mutationFn: (data: { grnId: number; line: any }) => procurementService.addGRNLine(data.grnId, data.line),
    onSuccess: async () => {
      toast.success('GRN line added');
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add GRN line'),
  });

  const branchById = React.useMemo(() => {
    const m = new Map<number, any>();
    for (const b of branchesQ.data ?? []) m.set(Number(b.id), b);
    return m;
  }, [branchesQ.data]);

  const vendorById = React.useMemo(() => {
    const m = new Map<number, any>();
    for (const v of vendorsQ.data ?? []) m.set(Number(v.id), v);
    return m;
  }, [vendorsQ.data]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">Procurement</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Purchase requisition → purchase order → goods receipt note (stock increases only when you post a receipt).
        </p>
      </div>

      <Card>
        <div className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
          <div className="font-semibold text-slate-800 dark:text-slate-100">Typical workflow</div>
          <ol className="list-decimal pl-5 space-y-1 text-slate-600 dark:text-slate-300">
            <li>Create a <span className="font-medium">purchase requisition</span> from a branch (what you need).</li>
            <li>Submit and approve it to generate a <span className="font-medium">purchase order</span> (what you ordered).</li>
            <li>Create a <span className="font-medium">goods receipt note</span>, add received lines with expiry dates, then <span className="font-medium">post</span> it to increase inventory.</li>
          </ol>
        </div>
      </Card>

      {showTabs && (
        <div className="flex flex-wrap gap-2">
          {[
            { k: 'prs', label: 'Purchase requisitions' },
            { k: 'pos', label: 'Purchase orders' },
            { k: 'grns', label: 'Goods receipt notes' },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k as ProcurementTabKey)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                tab === (t.k as ProcurementTabKey)
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'prs' && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Purchase requisitions</h2>
          </div>

          {prsQ.isLoading ? (
            <Loader />
          ) : (
            <>
              <div className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                A purchase requisition is a request from a branch asking for items (from a supplier or your warehouse).
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-2 mb-4">
                <select className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  value={form.pr_branch_id ?? ''} onChange={(e) => setForm({ ...form, pr_branch_id: e.target.value })}>
                  <option value="">Requesting branch (who needs it)…</option>
                  {(branchesQ.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <select className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  value={form.pr_vendor_id ?? ''} onChange={(e) => setForm({ ...form, pr_vendor_id: e.target.value })}>
                  <option value="">Requested from (supplier/warehouse)…</option>
                  {(vendorsQ.data ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name} ({v.type})</option>)}
                </select>
                <select className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  value={form.pr_item_id ?? ''} onChange={(e) => setForm({ ...form, pr_item_id: e.target.value })}>
                  <option value="">Item (ingredient/packaging)…</option>
                  {(itemsQ.data ?? []).map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}
                </select>
                <input className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  placeholder="Requested quantity" value={form.pr_qty ?? ''} onChange={(e) => setForm({ ...form, pr_qty: e.target.value })} />
                <select className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  value={form.pr_uom_id ?? ''} onChange={(e) => setForm({ ...form, pr_uom_id: e.target.value })}>
                  <option value="">Unit of measure…</option>
                  {(uomsQ.data ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.code}</option>)}
                </select>
                <div className="lg:col-span-5">
                  <Button
                    onClick={() =>
                      createPRM.mutate({
                        requesting_branch_id: Number(form.pr_branch_id),
                        requested_from_vendor_id: Number(form.pr_vendor_id),
                        lines: [
                          {
                            inventory_item_id: Number(form.pr_item_id),
                            requested_qty: Number(form.pr_qty),
                            requested_uom_id: Number(form.pr_uom_id),
                          },
                        ],
                      })
                    }
                  >
                    Create PR
                  </Button>
                </div>
              </div>

              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2 pr-4">ID</th>
                      <th className="py-2 pr-4">Requesting branch</th>
                      <th className="py-2 pr-4">Requested from</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 dark:text-slate-200">
                    {(prsQ.data ?? []).map((pr: any) => (
                      <tr key={pr.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="py-2 pr-4">{pr.id}</td>
                        <td className="py-2 pr-4">
                          {branchById.get(Number(pr.requestingBranchId))?.name ?? `Branch #${pr.requestingBranchId}`}
                        </td>
                        <td className="py-2 pr-4">
                          {vendorById.get(Number(pr.requestedFromVendorId))?.name ?? `Vendor #${pr.requestedFromVendorId}`}
                        </td>
                        <td className="py-2 pr-4">{pr.status}</td>
                        <td className="py-2 pr-4 flex gap-2">
                          <Button disabled={pr.status !== 'draft'} onClick={() => submitPRM.mutate(pr.id)}>Submit</Button>
                          <Button disabled={pr.status !== 'submitted'} onClick={() => approvePRM.mutate(pr.id)}>Approve → PO</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}

      {tab === 'pos' && (
        <Card>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Purchase orders</h2>
          {posQ.isLoading ? <Loader /> : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-2 pr-4">Purchase order number</th>
                    <th className="py-2 pr-4">Buyer branch</th>
                    <th className="py-2 pr-4">Vendor</th>
                    <th className="py-2 pr-4">Status</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700 dark:text-slate-200">
                  {(posQ.data ?? []).map((po: any) => (
                    <tr key={po.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="py-2 pr-4">{po.poNumber}</td>
                      <td className="py-2 pr-4">
                        {branchById.get(Number(po.buyerBranchId))?.name ?? `Branch #${po.buyerBranchId}`}
                      </td>
                      <td className="py-2 pr-4">
                        {vendorById.get(Number(po.vendorId))?.name ?? `Vendor #${po.vendorId}`}
                      </td>
                      <td className="py-2 pr-4">{po.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'grns' && (
        <Card>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Goods receipt notes</h2>
          <div className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Create a receipt, add received lines (with expiry dates for perishable items), then post it to increase stock.
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-2 mb-4">
            <input className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              placeholder="Purchase order ID" value={form.grn_po_id ?? ''} onChange={(e) => setForm({ ...form, grn_po_id: e.target.value })} />
            <input className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              placeholder="Branch ID (where goods are received)" value={form.grn_branch_id ?? ''} onChange={(e) => setForm({ ...form, grn_branch_id: e.target.value })} />
            <div />
            <Button onClick={() => createGRNM.mutate({ purchase_order_id: Number(form.grn_po_id), branch_id: Number(form.grn_branch_id) })}>
              Create GRN
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-7 gap-2 mb-4">
            <input className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              placeholder="Goods receipt note ID" value={form.grn_id ?? ''} onChange={(e) => setForm({ ...form, grn_id: e.target.value })} />
            <select className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              value={form.grn_line_item_id ?? ''} onChange={(e) => setForm({ ...form, grn_line_item_id: e.target.value })}>
              <option value="">Item received…</option>
              {(itemsQ.data ?? []).map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
            <input className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              placeholder="Received quantity" value={form.grn_line_qty ?? ''} onChange={(e) => setForm({ ...form, grn_line_qty: e.target.value })} />
            <select className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              value={form.grn_line_uom_id ?? ''} onChange={(e) => setForm({ ...form, grn_line_uom_id: e.target.value })}>
              <option value="">Unit of measure…</option>
              {(uomsQ.data ?? []).map((u: any) => <option key={u.id} value={u.id}>{u.code}</option>)}
            </select>
            <input className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              placeholder="Lot / batch code (optional)" value={form.grn_line_lot ?? ''} onChange={(e) => setForm({ ...form, grn_line_lot: e.target.value })} />
            <input className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              placeholder="Expiry (YYYY-MM-DD)" value={form.grn_line_expiry ?? ''} onChange={(e) => setForm({ ...form, grn_line_expiry: e.target.value })} />
            <Button onClick={() => addGRNLineM.mutate({ grnId: Number(form.grn_id), line: {
              inventory_item_id: Number(form.grn_line_item_id),
              received_qty: Number(form.grn_line_qty),
              received_uom_id: Number(form.grn_line_uom_id),
              lot_code: form.grn_line_lot || null,
              expiry_date: form.grn_line_expiry || null,
              location_id: null,
              notes: null,
            }})}>
              Add line
            </Button>
          </div>

          {grnsQ.isLoading ? <Loader /> : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-2 pr-4">ID</th>
                    <th className="py-2 pr-4">PO</th>
                    <th className="py-2 pr-4">Branch</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700 dark:text-slate-200">
                  {(grnsQ.data ?? []).map((g: any) => (
                    <tr key={g.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="py-2 pr-4">{g.id}</td>
                      <td className="py-2 pr-4">{g.purchaseOrderId}</td>
                      <td className="py-2 pr-4">{g.branchId}</td>
                      <td className="py-2 pr-4">{g.status}</td>
                      <td className="py-2 pr-4 flex gap-2">
                        <Button disabled={g.status !== 'draft'} onClick={() => postGRNM.mutate(g.id)}>Post</Button>
                        <Button disabled={g.status !== 'posted'} onClick={() => reverseGRNM.mutate(g.id)}>Reverse</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Tip: make sure you add all GRN lines (with expiry) before posting.
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default Procurement;

