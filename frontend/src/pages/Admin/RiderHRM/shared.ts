import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminService } from '../../../services/api/adminService';
import apiClient from '../../../utils/apiClient';
import { Branch } from '../../../types';

export const inputClass =
  'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:ring-2 focus:ring-red-500';
export const labelClass =
  'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1';

export type RiderSummary = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  rating_average: number | null;
  rating_count: number;
};

/** Active branches for the tenant (used by check-in, comp-plan and payroll scoping). */
export const useBranches = () =>
  useQuery({
    queryKey: ['admin-branches-simple'],
    queryFn: async () => {
      const response = await apiClient.get<Branch[]>('/admin/branches');
      return response.data ?? [];
    },
  });

/** Riders eligible for delivery assignment, with all-time customer star averages. */
export const useRiders = () =>
  useQuery({
    queryKey: ['admin-riders'],
    queryFn: () => adminService.getRiders(),
  });

export const useBranchesById = (branches: Branch[] | undefined) =>
  useMemo(() => {
    const map = new Map<number, Branch>();
    for (const branch of branches ?? []) map.set(branch.id, branch);
    return map;
  }, [branches]);

export const useRidersById = (riders: RiderSummary[] | undefined) =>
  useMemo(() => {
    const map = new Map<number, RiderSummary>();
    for (const rider of riders ?? []) map.set(rider.id, rider);
    return map;
  }, [riders]);

/** Shared page header used by every Rider HRM submodule page. */
export type RiderHrmPageHeaderProps = {
  title: string;
  subtitle?: string;
};
