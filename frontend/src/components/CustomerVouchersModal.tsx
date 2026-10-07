import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { adminService } from '../services/api';
import Modal from './Modal';

/**
 * A customer's coupon vouchers: counts by state, then each voucher. Shared by
 * the Customers table and the customer detail page.
 */
const CustomerVouchersModal: React.FC<{
  /** The customer whose vouchers to show; null closes the modal. */
  customer: { name?: string | null; phone: string } | null;
  onClose: () => void;
}> = ({ customer, onClose }) => {
  const { data: voucherData, isFetching: vouchersLoading } = useQuery({
    queryKey: ['customer-vouchers', customer?.phone],
    queryFn: () => adminService.getCustomerVouchers(customer!.phone),
    enabled: !!customer?.phone,
  });

  const voucherStats = useMemo(() => {
    const list = voucherData?.vouchers ?? [];
    const active = list.filter((v) => v.status === 'active').length;
    const used = list.filter((v) => v.status === 'used' || v.status === 'exhausted').length;
    const expired = list.filter((v) => v.status === 'expired' || v.status === 'revoked').length;
    return { total: list.length, active, used, expired };
  }, [voucherData]);

  return (
    <Modal
      isOpen={!!customer}
      onClose={onClose}
      title={customer ? `Vouchers — ${customer.name ?? customer.phone}` : 'Vouchers'}
      size="large"
    >
      {vouchersLoading ? (
        <p className="text-sm text-gray-500 py-8 text-center">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
            {[
              { label: 'Total', value: voucherStats.total, cls: 'text-gray-800 dark:text-slate-100' },
              { label: 'Active', value: voucherStats.active, cls: 'text-green-600' },
              { label: 'Used', value: voucherStats.used, cls: 'text-gray-500' },
              { label: 'Expired', value: voucherStats.expired, cls: 'text-red-500' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-gray-200 dark:border-slate-700 p-3 text-center">
                <div className={`text-2xl font-extrabold ${s.cls}`}>{s.value}</div>
                <div className="text-[11px] uppercase tracking-wide text-gray-400">{s.label}</div>
              </div>
            ))}
          </div>

          {(voucherData?.vouchers?.length ?? 0) === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">This customer has no vouchers yet.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {voucherData!.vouchers.map((v) => {
                const usable = v.status === 'active';
                const statusColor =
                  v.status === 'active' ? 'bg-green-100 text-green-700'
                  : v.status === 'used' || v.status === 'exhausted' ? 'bg-gray-200 text-gray-600'
                  : 'bg-red-100 text-red-700';
                return (
                  <div
                    key={v.id}
                    className={`rounded-xl border-2 border-dashed p-3 ${usable ? 'border-foodies-primary/40 bg-foodies-primary/5' : 'border-gray-200 opacity-70'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-base font-extrabold text-foodies-primary">
                          {v.type === 'percentage' ? `${v.value}% OFF` : `Rs ${v.value} OFF`}
                        </div>
                        <div className="text-[10px] text-gray-500 truncate">{v.title}</div>
                      </div>
                      {v.qr_token && usable && (
                        <div className="bg-white p-1 rounded shrink-0">
                          <QRCodeSVG value={v.qr_token} size={40} />
                        </div>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 font-mono text-gray-600">{v.reference}</span>
                      <span className={`px-2 py-0.5 rounded-full font-semibold ${statusColor}`}>{v.status}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {v.expires_at ? `exp ${new Date(v.expires_at).toLocaleDateString()}` : 'no expiry'}
                      {v.uses ? ` · used ${v.uses}×` : ''}
                      {v.per_customer_limit ? ` / ${v.per_customer_limit}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

export default CustomerVouchersModal;
