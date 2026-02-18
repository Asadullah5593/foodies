import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '../../utils/apiClient';
import { Branch } from '../../types';
import Loader from '../../components/Loader';
import Card from '../../components/Card';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import { formatCurrency } from '../../utils/currency';

const Reports: React.FC = () => {
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
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

  // Fetch sales summary
  const { data: salesSummary, isLoading: loadingSales } = useQuery({
    queryKey: ['salesSummary', selectedBranch, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranch) params.append('branch_id', selectedBranch.toString());
      params.append('date_from', dateFrom);
      params.append('date_to', dateTo);
      const response = await apiClient.get(`/admin/reports/sales-summary?${params.toString()}`);
      return response.data;
    },
    enabled: true,
  });

  // Fetch top items
  const { data: topItems, isLoading: loadingTopItems } = useQuery({
    queryKey: ['topItems', selectedBranch, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranch) params.append('branch_id', selectedBranch.toString());
      params.append('date_from', dateFrom);
      params.append('date_to', dateTo);
      const response = await apiClient.get(`/admin/reports/top-items?${params.toString()}`);
      return response.data;
    },
    enabled: true,
  });

  if (loadingSales || loadingTopItems) return <Loader fullScreen text="Loading reports..." />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">Reports</h1>

      <Card className="mb-6 p-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Filters</h4>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Branch</label>
            <select
              value={selectedBranch || ''}
              onChange={(e) => setSelectedBranch(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[180px]"
            >
              <option value="">All Branches</option>
              {branches?.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ({branch.code})
                </option>
              ))}
            </select>
          </div>
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
