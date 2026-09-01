import React, { useState } from 'react';
import { labelWithStatus } from '../../../utils/entityStatus';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import { useHasPermission } from '../../../hooks/useHasPermission';
import { adminService } from '../../../services/api/adminService';
import { RiderCompPlan, RiderCompPlanComponent } from '../../../types';
import { formatCurrency } from '../../../utils/currency';
import RiderHrmHeader from './RiderHrmHeader';
import { inputClass, labelClass, useBranches } from './shared';

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

const emptyPlanForm = (): {
  name: string;
  pay_method: string;
  branch_id: string;
  effective_from: string;
  effective_to: string;
  components: CompPlanFormComponent[];
} => ({
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

const RiderCompPlans: React.FC = () => {
  const queryClient = useQueryClient();
  const canCreate = useHasPermission('rider-comp-plans:create');
  const canActivate = useHasPermission('rider-comp-plans:activate');

  const [planForm, setPlanForm] = useState(emptyPlanForm);

  const { data: branchesList } = useBranches();

  const { data: compPlans } = useQuery({
    queryKey: ['rider-comp-plans'],
    queryFn: () => adminService.getRiderCompPlans(),
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
      setPlanForm(emptyPlanForm());
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

  const addPlanComponent = () => {
    setPlanForm((prev) => ({
      ...prev,
      components: [...prev.components, { ...defaultComponent(), sort_order: prev.components.length }],
    }));
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <RiderHrmHeader
        title="Compensation Plans"
        subtitle="The rider pay rulebook — versioned, branch- or tenant-scoped plans built from earning components (per-ride, timely-delivery, rating-threshold bonuses)."
      />

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
                  {labelWithStatus(branch.name, branch)}
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
        {canCreate && <div className="mt-4 flex justify-end">
          <Button
            variant="primary"
            isLoading={createPlanMutation.isPending}
            disabled={!planForm.name || planForm.components.some((c) => !c.name || !c.component_key)}
            onClick={() => createPlanMutation.mutate()}
          >
            Create plan
          </Button>
        </div>}
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
                    {plan.status !== 'active' && canActivate && (
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
    </div>
  );
};

export default RiderCompPlans;
