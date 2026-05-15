import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import Card from '../../components/Card';
import Button from '../../components/Button';
import Loader from '../../components/Loader';
import { adminService } from '../../services/api/adminService';
import apiClient from '../../utils/apiClient';
import {
  Branch,
  RiderCompPlan,
  RiderCompPlanComponent,
  RiderOnDuty,
  RiderPayrollRun,
  RiderProfile,
} from '../../types';
import { formatCurrency } from '../../utils/currency';

const inputClass =
  'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:ring-2 focus:ring-red-500';
const labelClass =
  'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1';

type CompPlanFormComponent = RiderCompPlanComponent & {
  min_rating_input?: string;
};

const defaultComponent = (): CompPlanFormComponent => ({
  component_key: `component_${Date.now()}`,
  name: '',
  component_type: 'earning',
  calc_basis: 'per_ride',
  value: 0,
  conditions: {},
  is_enabled: true,
  sort_order: 0,
  min_rating_input: '',
});

const RiderHRM: React.FC = () => {
  const queryClient = useQueryClient();

  const [profileForm, setProfileForm] = useState({
    user_id: '',
    employment_status: 'active',
    salary_type: 'hybrid',
    employee_code: '',
    base_salary: '',
    default_per_ride_commission: '',
    max_active_orders: '1',
    min_rating: '',
    min_timely_rate: '',
    is_active: true,
  });
  const [attendanceForm, setAttendanceForm] = useState({
    rider_user_id: '',
    branch_id: '',
    notes: '',
  });
  const [planForm, setPlanForm] = useState<{
    name: string;
    pay_method: string;
    branch_id: string;
    effective_from: string;
    effective_to: string;
    components: CompPlanFormComponent[];
  }>({
    name: '',
    pay_method: 'hybrid',
    branch_id: '',
    effective_from: '',
    effective_to: '',
    components: [
      {
        ...defaultComponent(),
        component_key: 'per_ride_commission',
        name: 'Per Ride Commission',
        calc_basis: 'per_ride',
      },
    ],
  });
  const [payrollForm, setPayrollForm] = useState({
    from: '',
    to: '',
    branch_id: '',
    timely_minutes: '45',
    expected_monthly_minutes: '12480',
  });

  const { data: branchesList } = useQuery({
    queryKey: ['admin-branches-simple'],
    queryFn: async () => {
      const response = await apiClient.get<Branch[]>('/admin/branches');
      return response.data ?? [];
    },
  });

  const { data: riders, isLoading } = useQuery({
    queryKey: ['admin-riders'],
    queryFn: () => adminService.getRiders(),
  });

  const { data: profiles } = useQuery({
    queryKey: ['rider-profiles'],
    queryFn: () => adminService.getRiderProfiles(),
  });

  const { data: onDuty } = useQuery({
    queryKey: ['rider-on-duty'],
    queryFn: () => adminService.getOnDutyRiders(),
    refetchInterval: 30000,
  });

  const { data: compPlans } = useQuery({
    queryKey: ['rider-comp-plans'],
    queryFn: () => adminService.getRiderCompPlans(),
  });

  const { data: payrollRuns } = useQuery({
    queryKey: ['rider-payroll-runs'],
    queryFn: () => adminService.getPayrollRuns(),
  });

  const { data: opsMetrics } = useQuery({
    queryKey: ['rider-ops-metrics'],
    queryFn: () => adminService.getRiderOpsMetrics(),
    refetchInterval: 30000,
  });

  const ridersById = useMemo(() => {
    const map = new Map<
      number,
      {
        id: number;
        name: string;
        email: string | null;
        phone: string | null;
        rating_average: number | null;
        rating_count: number;
      }
    >();
    for (const rider of riders ?? []) map.set(rider.id, rider);
    return map;
  }, [riders]);

  const branchesById = useMemo(() => {
    const map = new Map<number, Branch>();
    for (const branch of branchesList ?? []) map.set(branch.id, branch);
    return map;
  }, [branchesList]);

  const upsertProfileMutation = useMutation({
    mutationFn: () =>
      adminService.upsertRiderProfile({
        user_id: Number(profileForm.user_id),
        employment_status: profileForm.employment_status,
        salary_type: profileForm.salary_type,
        employee_code: profileForm.employee_code || undefined,
        base_salary: profileForm.base_salary ? Number(profileForm.base_salary) : 0,
        default_per_ride_commission: profileForm.default_per_ride_commission
          ? Number(profileForm.default_per_ride_commission)
          : 0,
        max_active_orders: profileForm.max_active_orders
          ? Number(profileForm.max_active_orders)
          : 1,
        min_rating: profileForm.min_rating ? Number(profileForm.min_rating) : undefined,
        min_timely_rate: profileForm.min_timely_rate
          ? Number(profileForm.min_timely_rate)
          : undefined,
        is_active: profileForm.is_active,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-profiles'] });
      toast.success('Rider profile saved');
      setProfileForm((prev) => ({
        ...prev,
        employee_code: '',
        base_salary: '',
        default_per_ride_commission: '',
        min_rating: '',
        min_timely_rate: '',
      }));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to save rider profile');
    },
  });

  const checkInMutation = useMutation({
    mutationFn: () =>
      adminService.adminCheckInRider({
        rider_user_id: Number(attendanceForm.rider_user_id),
        branch_id: Number(attendanceForm.branch_id),
        notes: attendanceForm.notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-on-duty'] });
      toast.success('Rider checked in');
      setAttendanceForm((prev) => ({ ...prev, notes: '' }));
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to check in rider');
    },
  });

  const checkOutMutation = useMutation({
    mutationFn: (riderUserId: number) =>
      adminService.adminCheckOutRider({ rider_user_id: riderUserId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-on-duty'] });
      toast.success('Rider checked out');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to check out rider');
    },
  });

  const createPlanMutation = useMutation({
    mutationFn: () =>
      adminService.createRiderCompPlan({
        name: planForm.name,
        pay_method: planForm.pay_method,
        branch_id: planForm.branch_id ? Number(planForm.branch_id) : undefined,
        effective_from: planForm.effective_from || undefined,
        effective_to: planForm.effective_to || undefined,
        components: planForm.components.map((component, idx) => ({
          component_key:
            component.component_key ||
            component.name.trim().toLowerCase().replace(/\s+/g, '_') ||
            `component_${idx + 1}`,
          name: component.name,
          component_type: component.component_type,
          calc_basis: component.calc_basis,
          value: Number(component.value ?? 0),
          conditions:
            component.calc_basis === 'rating_threshold_bonus' &&
            component.min_rating_input
              ? { min_rating: Number(component.min_rating_input) }
              : component.conditions ?? {},
          is_enabled: component.is_enabled ?? true,
          sort_order: idx,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-comp-plans'] });
      toast.success('Compensation plan created');
      setPlanForm({
        name: '',
        pay_method: 'hybrid',
        branch_id: '',
        effective_from: '',
        effective_to: '',
        components: [
          {
            ...defaultComponent(),
            component_key: 'per_ride_commission',
            name: 'Per Ride Commission',
            calc_basis: 'per_ride',
          },
        ],
      });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create compensation plan');
    },
  });

  const activatePlanMutation = useMutation({
    mutationFn: (planId: number) => adminService.activateRiderCompPlan(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-comp-plans'] });
      toast.success('Compensation plan activated');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to activate plan');
    },
  });

  const runPayrollMutation = useMutation({
    mutationFn: () =>
      adminService.runPayroll({
        from: payrollForm.from,
        to: payrollForm.to,
        branch_id: payrollForm.branch_id ? Number(payrollForm.branch_id) : undefined,
        timely_minutes: payrollForm.timely_minutes ? Number(payrollForm.timely_minutes) : undefined,
        expected_monthly_minutes: payrollForm.expected_monthly_minutes
          ? Number(payrollForm.expected_monthly_minutes)
          : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-payroll-runs'] });
      toast.success('Payroll run created');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to run payroll');
    },
  });

  const reversePayrollMutation = useMutation({
    mutationFn: (runId: number) => adminService.reversePayrollRun(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-payroll-runs'] });
      toast.success('Payroll run reversed');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to reverse payroll run');
    },
  });

  if (isLoading) {
    return <Loader fullScreen text="Loading rider HRM..." />;
  }

  const addPlanComponent = () => {
    setPlanForm((prev) => ({
      ...prev,
      components: [...prev.components, { ...defaultComponent(), sort_order: prev.components.length }],
    }));
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">
            Rider HRM
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Manage rider salary rules, attendance, on-duty presence, payroll, and the dispatch prerequisites required for automatic order assignment.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/admin/orders">
            <Button variant="outline">Go to Orders</Button>
          </Link>
          <Link to="/admin/branches">
            <Button variant="outline">Configure Branches</Button>
          </Link>
        </div>
      </div>

      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Riders with HR profiles
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              {profiles?.length ?? 0}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Riders on duty
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              {onDuty?.length ?? 0}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Active comp plans
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              {(compPlans ?? []).filter((plan) => plan.status === 'active').length}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
              Auto-assignment success
            </p>
            <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              {opsMetrics?.counters?.auto_assignment_success ?? 0}
            </p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">
              Rider Profiles
            </h2>
            <span className="text-xs text-gray-500 dark:text-slate-400">
              salary + dispatch thresholds
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelClass}>Rider</label>
              <select
                value={profileForm.user_id}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, user_id: e.target.value }))}
                className={inputClass}
              >
                <option value="">Select rider</option>
                {(riders ?? []).map((rider) => (
                  <option key={rider.id} value={rider.id}>
                    {rider.name} {rider.phone ? `· ${rider.phone}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Salary type</label>
              <select
                value={profileForm.salary_type}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, salary_type: e.target.value }))}
                className={inputClass}
              >
                <option value="fixed">Fixed salary</option>
                <option value="commission">Commission only</option>
                <option value="hybrid">Base + per ride + extras</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Employment status</label>
              <select
                value={profileForm.employment_status}
                onChange={(e) =>
                  setProfileForm((prev) => ({ ...prev, employment_status: e.target.value }))
                }
                className={inputClass}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Employee code</label>
              <input
                value={profileForm.employee_code}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, employee_code: e.target.value }))}
                className={inputClass}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className={labelClass}>Base salary</label>
              <input
                type="number"
                value={profileForm.base_salary}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, base_salary: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Per-ride commission</label>
              <input
                type="number"
                value={profileForm.default_per_ride_commission}
                onChange={(e) =>
                  setProfileForm((prev) => ({
                    ...prev,
                    default_per_ride_commission: e.target.value,
                  }))
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Max active orders</label>
              <input
                type="number"
                min="1"
                value={profileForm.max_active_orders}
                onChange={(e) =>
                  setProfileForm((prev) => ({ ...prev, max_active_orders: e.target.value }))
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Minimum rating</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="5"
                value={profileForm.min_rating}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, min_rating: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Minimum timely rate %</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={profileForm.min_timely_rate}
                onChange={(e) =>
                  setProfileForm((prev) => ({ ...prev, min_timely_rate: e.target.value }))
                }
                className={inputClass}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={profileForm.is_active}
                onChange={(e) => setProfileForm((prev) => ({ ...prev, is_active: e.target.checked }))}
              />
              HRM profile active
            </label>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              isLoading={upsertProfileMutation.isPending}
              disabled={!profileForm.user_id}
              onClick={() => upsertProfileMutation.mutate()}
            >
              Save rider profile
            </Button>
          </div>
          <div className="mt-6 border-t border-gray-200 dark:border-slate-700 pt-4 space-y-3">
            {(profiles ?? []).length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-slate-400">
                No rider HR profiles yet.
              </p>
            ) : (
              (profiles ?? []).map((profile: RiderProfile) => (
                <div
                  key={profile.id}
                  className="rounded-lg border border-gray-200 dark:border-slate-700 p-3"
                >
                  <div className="flex justify-between gap-4">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-slate-100">
                        {profile.user_name ?? `Rider #${profile.user_id}`}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-slate-400">
                        {profile.salary_type} · base {formatCurrency(profile.base_salary)} · ride {formatCurrency(profile.default_per_ride_commission)}
                      </p>
                    </div>
                    <span className={`text-xs font-medium ${profile.is_active ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {profile.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">
              Attendance & On-Duty
            </h2>
            <span className="text-xs text-gray-500 dark:text-slate-400">
              required for auto-assignment
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Rider</label>
              <select
                value={attendanceForm.rider_user_id}
                onChange={(e) =>
                  setAttendanceForm((prev) => ({ ...prev, rider_user_id: e.target.value }))
                }
                className={inputClass}
              >
                <option value="">Select rider</option>
                {(riders ?? []).map((rider) => (
                  <option key={rider.id} value={rider.id}>
                    {rider.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Branch</label>
              <select
                value={attendanceForm.branch_id}
                onChange={(e) =>
                  setAttendanceForm((prev) => ({ ...prev, branch_id: e.target.value }))
                }
                className={inputClass}
              >
                <option value="">Select branch</option>
                {(branchesList ?? []).map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Notes</label>
              <input
                value={attendanceForm.notes}
                onChange={(e) => setAttendanceForm((prev) => ({ ...prev, notes: e.target.value }))}
                className={inputClass}
                placeholder="Optional check-in note"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              isLoading={checkInMutation.isPending}
              disabled={!attendanceForm.rider_user_id || !attendanceForm.branch_id}
              onClick={() => checkInMutation.mutate()}
            >
              Check in rider
            </Button>
          </div>

          <div className="mt-6 border-t border-gray-200 dark:border-slate-700 pt-4 space-y-3">
            {(onDuty ?? []).length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-slate-400">
                No riders are currently on duty.
              </p>
            ) : (
              (onDuty ?? []).map((entry: RiderOnDuty) => {
                const rider = ridersById.get(entry.rider_user_id);
                const branch = branchesById.get(entry.branch_id);
                return (
                  <div
                    key={`${entry.rider_user_id}-${entry.branch_id}`}
                    className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium text-gray-900 dark:text-slate-100">
                        {rider?.name ?? `Rider #${entry.rider_user_id}`}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-slate-400">
                        {branch?.name ?? `Branch #${entry.branch_id}`} · heartbeat {entry.last_heartbeat_at ? new Date(entry.last_heartbeat_at).toLocaleTimeString() : '—'} · location {entry.last_location_at ? new Date(entry.last_location_at).toLocaleTimeString() : '—'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                        Coordinates:{' '}
                        {entry.last_latitude != null && entry.last_longitude != null
                          ? `${entry.last_latitude.toFixed(5)}, ${entry.last_longitude.toFixed(5)}`
                          : 'waiting for rider browser GPS'}
                      </p>
                      {entry.last_latitude != null && entry.last_longitude != null ? (
                        <a
                          href={`https://www.google.com/maps?q=${entry.last_latitude},${entry.last_longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Open current rider location
                        </a>
                      ) : null}
                    </div>
                    <Button
                      size="small"
                      variant="outline"
                      isLoading={checkOutMutation.isPending}
                      onClick={() => checkOutMutation.mutate(entry.rider_user_id)}
                    >
                      Check out
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">
              Compensation Plans
            </h2>
            <span className="text-xs text-gray-500 dark:text-slate-400">
              fixed, commission, hybrid
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Plan name</label>
              <input
                value={planForm.name}
                onChange={(e) => setPlanForm((prev) => ({ ...prev, name: e.target.value }))}
                className={inputClass}
                placeholder="e.g. Karachi riders plan"
              />
            </div>
            <div>
              <label className={labelClass}>Pay method</label>
              <select
                value={planForm.pay_method}
                onChange={(e) => setPlanForm((prev) => ({ ...prev, pay_method: e.target.value }))}
                className={inputClass}
              >
                <option value="fixed">Fixed salary</option>
                <option value="commission">Commission only</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Branch scope</label>
              <select
                value={planForm.branch_id}
                onChange={(e) => setPlanForm((prev) => ({ ...prev, branch_id: e.target.value }))}
                className={inputClass}
              >
                <option value="">All branches</option>
                {(branchesList ?? []).map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Effective from</label>
              <input
                type="date"
                value={planForm.effective_from}
                onChange={(e) =>
                  setPlanForm((prev) => ({ ...prev, effective_from: e.target.value }))
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Effective to</label>
              <input
                type="date"
                value={planForm.effective_to}
                onChange={(e) =>
                  setPlanForm((prev) => ({ ...prev, effective_to: e.target.value }))
                }
                className={inputClass}
              />
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {planForm.components.map((component, index) => (
              <div
                key={`${component.component_key}-${index}`}
                className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    value={component.name}
                    onChange={(e) =>
                      setPlanForm((prev) => ({
                        ...prev,
                        components: prev.components.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, name: e.target.value } : entry
                        ),
                      }))
                    }
                    className={inputClass}
                    placeholder="Component name"
                  />
                  <input
                    value={component.component_key}
                    onChange={(e) =>
                      setPlanForm((prev) => ({
                        ...prev,
                        components: prev.components.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, component_key: e.target.value } : entry
                        ),
                      }))
                    }
                    className={inputClass}
                    placeholder="component_key"
                  />
                  <select
                    value={component.calc_basis}
                    onChange={(e) =>
                      setPlanForm((prev) => ({
                        ...prev,
                        components: prev.components.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, calc_basis: e.target.value } : entry
                        ),
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="flat">Flat</option>
                    <option value="per_ride">Per ride</option>
                    <option value="timely_delivery">Timely delivery</option>
                    <option value="rating_threshold_bonus">Rating threshold bonus</option>
                  </select>
                  <input
                    type="number"
                    value={component.value}
                    onChange={(e) =>
                      setPlanForm((prev) => ({
                        ...prev,
                        components: prev.components.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, value: Number(e.target.value) } : entry
                        ),
                      }))
                    }
                    className={inputClass}
                    placeholder="Value"
                  />
                  {component.calc_basis === 'rating_threshold_bonus' && (
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="5"
                      value={component.min_rating_input ?? ''}
                      onChange={(e) =>
                        setPlanForm((prev) => ({
                          ...prev,
                          components: prev.components.map((entry, entryIndex) =>
                            entryIndex === index
                              ? { ...entry, min_rating_input: e.target.value }
                              : entry
                          ),
                        }))
                      }
                      className={inputClass}
                      placeholder="Minimum rating"
                    />
                  )}
                </div>
                <div className="flex justify-end">
                  <Button
                    size="small"
                    variant="outline"
                    onClick={() =>
                      setPlanForm((prev) => ({
                        ...prev,
                        components: prev.components.filter((_, entryIndex) => entryIndex !== index),
                      }))
                    }
                    disabled={planForm.components.length === 1}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <Button size="small" variant="outline" onClick={addPlanComponent}>
              Add component
            </Button>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              isLoading={createPlanMutation.isPending}
              disabled={!planForm.name || planForm.components.some((c) => !c.name || !c.component_key)}
              onClick={() => createPlanMutation.mutate()}
            >
              Create plan
            </Button>
          </div>
          <div className="mt-6 border-t border-gray-200 dark:border-slate-700 pt-4 space-y-3">
            {(compPlans ?? []).length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-slate-400">
                No compensation plans yet.
              </p>
            ) : (
              (compPlans ?? []).map((plan: RiderCompPlan) => (
                <div
                  key={plan.id}
                  className="rounded-lg border border-gray-200 dark:border-slate-700 p-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-slate-100">
                        {plan.name}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-slate-400">
                        {plan.pay_method} · v{plan.version} · {plan.component_count ?? plan.components.length} components
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium ${plan.status === 'active' ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'}`}>
                        {plan.status}
                      </span>
                      {plan.status !== 'active' && (
                        <Button
                          size="small"
                          variant="outline"
                          isLoading={activatePlanMutation.isPending}
                          onClick={() => activatePlanMutation.mutate(plan.id)}
                        >
                          Activate
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {plan.components.map((component) => (
                      <span
                        key={`${plan.id}-${component.component_key}`}
                        className="text-xs rounded-full bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 px-2 py-1"
                      >
                        {component.name}: {formatCurrency(Number(component.value ?? 0))} · {component.calc_basis}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">
              Payroll Runs
            </h2>
            <span className="text-xs text-gray-500 dark:text-slate-400">
              custom date range
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>From</label>
              <input
                type="date"
                value={payrollForm.from}
                onChange={(e) => setPayrollForm((prev) => ({ ...prev, from: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>To</label>
              <input
                type="date"
                value={payrollForm.to}
                onChange={(e) => setPayrollForm((prev) => ({ ...prev, to: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Branch scope</label>
              <select
                value={payrollForm.branch_id}
                onChange={(e) => setPayrollForm((prev) => ({ ...prev, branch_id: e.target.value }))}
                className={inputClass}
              >
                <option value="">All branches</option>
                {(branchesList ?? []).map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Timely minutes</label>
              <input
                type="number"
                value={payrollForm.timely_minutes}
                onChange={(e) =>
                  setPayrollForm((prev) => ({ ...prev, timely_minutes: e.target.value }))
                }
                className={inputClass}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              variant="primary"
              isLoading={runPayrollMutation.isPending}
              disabled={!payrollForm.from || !payrollForm.to}
              onClick={() => runPayrollMutation.mutate()}
            >
              Run payroll
            </Button>
          </div>
          <div className="mt-6 border-t border-gray-200 dark:border-slate-700 pt-4 space-y-3">
            {(payrollRuns ?? []).length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-slate-400">
                No payroll runs yet.
              </p>
            ) : (
              (payrollRuns ?? []).map((run: RiderPayrollRun) => (
                <div
                  key={run.id}
                  className="rounded-lg border border-gray-200 dark:border-slate-700 p-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-gray-900 dark:text-slate-100">
                        {run.period_from} to {run.period_to}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-slate-400">
                        {run.rider_count ?? 0} riders · {formatCurrency(Number(run.total_amount ?? 0))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium ${run.status === 'finalized' ? 'text-emerald-600 dark:text-emerald-400' : run.status === 'reversed' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-slate-400'}`}>
                        {run.status}
                      </span>
                      {run.status === 'finalized' && (
                        <Button
                          size="small"
                          variant="outline"
                          isLoading={reversePayrollMutation.isPending}
                          onClick={() => reversePayrollMutation.mutate(run.id)}
                        >
                          Reverse
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">
            Dispatch & Ops Metrics
          </h2>
          <Link to="/admin/orders" className="text-sm text-red-600 dark:text-red-400 hover:underline">
            Check Orders
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Auto-assignment success</p>
            <p className="text-xl font-bold text-gray-900 dark:text-slate-100">
              {opsMetrics?.counters?.auto_assignment_success ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">No eligible riders</p>
            <p className="text-xl font-bold text-gray-900 dark:text-slate-100">
              {opsMetrics?.counters?.auto_assignment_no_eligible_riders ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Assignment latency p95</p>
            <p className="text-xl font-bold text-gray-900 dark:text-slate-100">
              {opsMetrics?.samples?.assignment_latency_ms?.p95 ?? 0} ms
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Payroll reversals</p>
            <p className="text-xl font-bold text-gray-900 dark:text-slate-100">
              {opsMetrics?.counters?.payroll_run_reversal_count ?? 0}
            </p>
          </div>
        </div>
        <div className="mt-4 text-sm text-gray-600 dark:text-slate-300 space-y-1">
          <p>Automatic assignment for a new delivery order requires: branch coordinates + radius, rider HR profile, branch rider role, checked-in status, and fresh rider heartbeat/location.</p>
          <p>For old unassigned orders, use the new retry auto-assign action from the Orders page after riders are ready.</p>
        </div>
      </Card>
    </div>
  );
};

export default RiderHRM;
