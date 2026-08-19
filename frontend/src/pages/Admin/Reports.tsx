import React, { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import apiClient from '../../utils/apiClient';
import { Branch } from '../../types';
import Loader from '../../components/Loader';
import FetchingOverlay from '../../components/FetchingOverlay';
import Card from '../../components/Card';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import { formatCurrency } from '../../utils/currency';

/** GET /admin/reports/discounts — where the discounts went. */
interface DiscountsReport {
  total_discounts: number;
  /** Out of the merchant's own margin. */
  merchant_funded: number;
  /** Funded by the bank, via a card offer. */
  bank_funded: number;
  by_type: {
    product_promotion: number;
    discount: number;
    coupon: number;
    card: number;
  };
  cards: Array<{
    card_id: number;
    card_name: string;
    bank: string | null;
    orders: number;
    discounted_orders: number;
    missed_orders: number;
    total_discount: number;
    total_revenue: number;
  }>;
}

const Reports: React.FC = () => {
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);

  // Fetch branches
  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await apiClient.get<Branch[]>('/admin/branches');
      return response.data;
    },
  });

  // Brands (brand-locked users get only their own brand back)
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<Array<{ id: number; name: string }>>('/admin/brands');
      return response.data;
    },
  });

  const reportParams = () => {
    const params = new URLSearchParams();
    if (selectedBranch) params.append('branch_id', selectedBranch.toString());
    if (selectedBrand) params.append('brand_id', selectedBrand.toString());
    params.append('date_from', dateFrom);
    params.append('date_to', dateTo);
    return params.toString();
  };

  // Fetch sales summary
  const { data: salesSummary, isLoading: loadingSales, isPlaceholderData: summaryIsPlaceholder } = useQuery({
    queryKey: ['salesSummary', selectedBranch, selectedBrand, dateFrom, dateTo],
    queryFn: async () => {
      const response = await apiClient.get(`/admin/reports/sales-summary?${reportParams()}`);
      return response.data;
    },
    placeholderData: keepPreviousData,
    enabled: true,
  });

  // Fetch top items
  const { data: topItems, isLoading: loadingTopItems, isPlaceholderData: topItemsIsPlaceholder } = useQuery({
    queryKey: ['topItems', selectedBranch, selectedBrand, dateFrom, dateTo],
    queryFn: async () => {
      const response = await apiClient.get(`/admin/reports/top-items?${reportParams()}`);
      return response.data;
    },
    placeholderData: keepPreviousData,
    enabled: true,
  });

  const { data: discounts, isPlaceholderData: discountsIsPlaceholder } = useQuery<DiscountsReport>({
    queryKey: ['discountsReport', selectedBranch, selectedBrand, dateFrom, dateTo],
    queryFn: async () => {
      const response = await apiClient.get<DiscountsReport>(`/admin/reports/discounts?${reportParams()}`);
      return response.data;
    },
    placeholderData: keepPreviousData,
  });

  if (loadingSales || loadingTopItems) return <Loader fullScreen text="Loading reports..." />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">Reports</h1>

      <Card className="mb-6 p-4 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-wrap gap-4 items-end">
          <SearchableSelect
            label="Branch"
            value={selectedBranch ? String(selectedBranch) : ''}
            onChange={(v) => setSelectedBranch(v ? parseInt(v, 10) : null)}
            options={[
              { value: '', label: 'All Branches' },
              ...(branches ?? []).map((branch) => ({
                value: String(branch.id),
                label: `${branch.name} (${branch.code})`,
              })),
            ]}
            placeholder="All Branches"
            minWidth="min-w-[180px]"
          />
          <SearchableSelect
            label="Brand"
            value={selectedBrand ? String(selectedBrand) : ''}
            onChange={(v) => setSelectedBrand(v ? parseInt(v, 10) : null)}
            options={[
              { value: '', label: 'All Brands' },
              ...(brands ?? []).map((brand) => ({
                value: String(brand.id),
                label: brand.name,
              })),
            ]}
            placeholder="All Brands"
            minWidth="min-w-[160px]"
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <ClearFiltersButton
            onClick={() => {
              setSelectedBranch(null);
              setSelectedBrand(null);
              const today = new Date().toISOString().split('T')[0];
              setDateFrom(today);
              setDateTo(today);
            }}
          />
        </div>
      </Card>

      <FetchingOverlay active={summaryIsPlaceholder} label="Updating sales summary…">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <Card>
          <h3 className="text-sm font-medium text-gray-500 mb-2">Total Sales</h3>
          <p className="text-3xl font-bold text-green-600">
            {formatCurrency(Number(salesSummary?.total_sales ?? 0))}
          </p>
        </Card>

        <Card>
          <h3 className="text-sm font-medium text-gray-500 mb-2">Total Orders</h3>
          <p className="text-3xl font-bold text-blue-600">
            {salesSummary?.total_orders || 0}
          </p>
        </Card>

        <Card>
          <h3 className="text-sm font-medium text-gray-500 mb-2">Average Order Value</h3>
          <p className="text-3xl font-bold text-purple-600">
            {formatCurrency(Number(salesSummary?.average_order_value ?? 0))}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <Card>
          <h3 className="text-sm font-medium text-gray-500 mb-2">Total Tax</h3>
          <p className="text-3xl font-bold text-purple-700">
            {formatCurrency(Number(salesSummary?.total_tax ?? 0))}
          </p>
        </Card>
        <Card>
          <h3 className="text-sm font-medium text-gray-500 mb-2">Total Delivery Fees</h3>
          <p className="text-3xl font-bold text-sky-700">
            {formatCurrency(Number(salesSummary?.total_delivery_fee ?? 0))}
          </p>
        </Card>
        <Card>
          <h3 className="text-sm font-medium text-gray-500 mb-2">Total Discounts</h3>
          <p className="text-3xl font-bold text-amber-700">
            {formatCurrency(Number(salesSummary?.total_discounts ?? 0))}
          </p>
        </Card>
      </div>
      </FetchingOverlay>

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Discounts</h2>
        <FetchingOverlay active={discountsIsPlaceholder} label="Updating discounts…">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <Card>
            <h3 className="text-sm font-medium text-gray-500 mb-2">Out of your margin</h3>
            <p className="text-3xl font-bold text-rose-700">
              {formatCurrency(discounts?.merchant_funded ?? 0)}
            </p>
            <p className="mt-1 text-xs text-gray-400">Product promotions, discounts and coupons</p>
          </Card>
          <Card>
            <h3 className="text-sm font-medium text-gray-500 mb-2">Funded by the bank</h3>
            <p className="text-3xl font-bold text-emerald-700">
              {formatCurrency(discounts?.bank_funded ?? 0)}
            </p>
            <p className="mt-1 text-xs text-gray-400">Bank card offers</p>
          </Card>
        </div>
        <Card className="mb-4">
          <table className="w-full text-sm">
            <tbody>
              {([
                ['Product promotions', discounts?.by_type.product_promotion],
                ['Discounts', discounts?.by_type.discount],
                ['Coupons', discounts?.by_type.coupon],
                ['Bank card offers', discounts?.by_type.card],
              ] as Array<[string, number | undefined]>).map(([label, value]) => (
                <tr key={label} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 text-gray-600">{label}</td>
                  <td className="py-2 text-right font-semibold text-gray-800">
                    {formatCurrency(value ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {discounts != null && discounts.cards.length > 0 && (
          <Card>
            <h3 className="mb-3 text-sm font-medium text-gray-500">By bank card</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="py-2">Card</th>
                    <th className="py-2 text-right">Orders</th>
                    <th className="py-2 text-right">Got the discount</th>
                    <th className="py-2 text-right">Discount given</th>
                    <th className="py-2 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {discounts.cards.map((c) => (
                    <tr key={c.card_id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 font-medium text-gray-800">
                        {c.bank ? `${c.bank} — ${c.card_name}` : c.card_name}
                      </td>
                      <td className="py-2 text-right">{c.orders}</td>
                      <td className="py-2 text-right">
                        {c.discounted_orders}
                        {c.missed_orders > 0 && (
                          <span className="ml-1 text-xs text-amber-600" title="Paid with this card but earned nothing — below the minimum spend, or outside the offer's dates/times.">
                            ({c.missed_orders} missed)
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right font-semibold">{formatCurrency(c.total_discount)}</td>
                      <td className="py-2 text-right">{formatCurrency(c.total_revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        </FetchingOverlay>
      </div>

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Top Selling Items</h2>
        <FetchingOverlay active={topItemsIsPlaceholder} label="Updating top items…">
        {topItems && topItems.length === 0 ? (
          <Card>
            <p className="text-center text-gray-500 py-8">No data available</p>
          </Card>
        ) : (
          <div className="grid gap-4">
            {topItems?.map((item: any, index: number) => (
              <Card key={item.id || index} hover>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <span className="text-2xl font-bold text-gray-400">#{index + 1}</span>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800">{item.name || item.menu_item_name}</h3>
                      <p className="text-sm text-gray-600">Quantity: {item.quantity || 0}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-green-600">
                      {formatCurrency(Number(item.total_revenue ?? 0))}
                    </p>
                    <p className="text-sm text-gray-600">Revenue</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
        </FetchingOverlay>
      </div>
    </div>
  );
};

export default Reports;
