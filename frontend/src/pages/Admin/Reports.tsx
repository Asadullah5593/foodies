import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '../../utils/apiClient';
import { Branch } from '../../types';
import Loader from '../../components/Loader';
import Card from '../../components/Card';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import { formatCurrency } from '../../utils/currency';

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
  const { data: salesSummary, isLoading: loadingSales } = useQuery({
    queryKey: ['salesSummary', selectedBranch, selectedBrand, dateFrom, dateTo],
    queryFn: async () => {
      const response = await apiClient.get(`/admin/reports/sales-summary?${reportParams()}`);
      return response.data;
    },
    enabled: true,
  });

  // Fetch top items
  const { data: topItems, isLoading: loadingTopItems } = useQuery({
    queryKey: ['topItems', selectedBranch, selectedBrand, dateFrom, dateTo],
    queryFn: async () => {
      const response = await apiClient.get(`/admin/reports/top-items?${reportParams()}`);
      return response.data;
    },
    enabled: true,
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

      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Top Selling Items</h2>
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
      </div>
    </div>
  );
};

export default Reports;
