import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { Shift, Branch, User } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import Button from '../../components/Button';
import SearchableSelect from '../../components/SearchableSelect';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';

const Shifts: React.FC = () => {
  const queryClient = useQueryClient();
  const [showOpenForm, setShowOpenForm] = useState(false);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailShiftId, setDetailShiftId] = useState<number | null>(null);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [formData, setFormData] = useState({
    branch_id: '',
    user_id: '',
    opening_cash: '',
    notes: '',
  });
  const [closeFormData, setCloseFormData] = useState({
    actual_cash: '',
    notes: '',
  });
  const [page, setPage] = useState(1);

  // Fetch branches
  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await apiClient.get<Branch[]>('/admin/branches');
      return response.data;
    },
  });

  // Fetch users
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await apiClient.get<User[]>('/admin/users');
      return response.data;
    },
  });

  // Fetch shifts
  const { data: shifts, isLoading } = useQuery({
    queryKey: ['shifts', selectedBranch, statusFilter],
    queryFn: () => adminService.getShifts(selectedBranch || undefined, statusFilter || undefined),
  });

  const shiftList = shifts ?? [];
  const paginatedShifts = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return shiftList.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [shiftList, page]);
  React.useEffect(() => setPage(1), [selectedBranch, statusFilter]);

  // Fetch shift detail for modal
  const { data: shiftDetail } = useQuery({
    queryKey: ['shift-detail', detailShiftId],
    queryFn: () => adminService.getShift(detailShiftId!),
    enabled: !!detailShiftId,
  });

  const createMutation = useMutation({
    mutationFn: adminService.createShift,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setShowOpenForm(false);
      setFormData({ branch_id: '', user_id: '', opening_cash: '', notes: '' });
      toast.success('Shift opened successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to open shift');
    },
  });

  const closeMutation = useMutation({
    mutationFn: ({ id, actualCash, notes }: { id: number; actualCash: number; notes?: string }) =>
      adminService.closeShift(id, actualCash, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setShowCloseForm(false);
      setSelectedShift(null);
      setCloseFormData({ actual_cash: '', notes: '' });
      toast.success('Shift closed successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to close shift');
    },
  });

  const handleOpenShift = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      branch_id: parseInt(formData.branch_id),
      user_id: parseInt(formData.user_id),
      opening_cash: parseFloat(formData.opening_cash),
      notes: formData.notes || undefined,
    });
  };

  const handleCloseShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShift) return;
    closeMutation.mutate({
      id: selectedShift.id,
      actualCash: parseFloat(closeFormData.actual_cash),
      notes: closeFormData.notes || undefined,
    });
  };

  const isSubmitting = createMutation.isPending || closeMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading shifts...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Shifts</h1>
        <Button onClick={() => setShowOpenForm(true)}>Open New Shift</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <SearchableSelect
          label="Filter by Branch"
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
        />
        <SearchableSelect
          label="Filter by Status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: '', label: 'All Statuses' },
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
          ]}
          placeholder="All Statuses"
        />
      </div>

      <Modal isOpen={showOpenForm} onClose={() => setShowOpenForm(false)} title="Open New Shift" size="medium">
        <form onSubmit={handleOpenShift} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch *</label>
            <select
              value={formData.branch_id}
              onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select Branch</option>
              {branches?.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ({branch.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">User *</label>
            <select
              value={formData.user_id}
              onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select User</option>
              {users?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Opening Cash *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.opening_cash}
              onChange={(e) => setFormData({ ...formData, opening_cash: e.target.value })}
              required
              placeholder="0.00"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowOpenForm(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Open Shift
            </Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={showCloseForm} onClose={() => setShowCloseForm(false)} title="Close Shift" size="medium">
        <form onSubmit={handleCloseShift} className="space-y-4">
          {selectedShift && (
            <>
              <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                <p className="text-sm"><strong>Shift Number:</strong> {selectedShift.shift_number}</p>
                <p className="text-sm"><strong>Opening Cash:</strong> {formatCurrency(selectedShift.opening_cash)}</p>
                <p className="text-sm"><strong>Opened At:</strong> {new Date(selectedShift.opened_at).toLocaleString()}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Actual Cash *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={closeFormData.actual_cash}
                  onChange={(e) => setCloseFormData({ ...closeFormData, actual_cash: e.target.value })}
                  required
                  placeholder="0.00"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={closeFormData.notes}
                  onChange={(e) => setCloseFormData({ ...closeFormData, notes: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowCloseForm(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={closeMutation.isPending}>
              Close Shift
            </Button>
          </div>
        </form>
      </Modal>

      <div className="w-full space-y-3">
        {shiftList.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No shifts found</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedShifts.map((shift, i) => (
                <AccentedListRow
                  key={shift.id}
                  accent={shift.status === 'open' ? 'active' : 'inactive'}
                  initial={shift.shift_number?.charAt(0) ?? 'S'}
                  title={shift.shift_number ?? `Shift #${shift.id}`}
                  subtitle={
                    <>
                      <p>Branch: {shift.branch?.name || 'N/A'}</p>
                      <p>User: {shift.user?.name || 'N/A'}</p>
                      <p>Opening: {formatCurrency(shift.opening_cash)} · Opened: {new Date(shift.opened_at).toLocaleString()}</p>
                    </>
                  }
                  statusLabel={shift.status?.toUpperCase()}
                  statusVariant={shift.status === 'open' ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      <Button size="small" variant="view" onClick={() => { setDetailShiftId(shift.id); setShowDetailModal(true); }}>View</Button>
                      {shift.status === 'open' && <Button size="small" variant="danger" onClick={() => { setSelectedShift(shift); setCloseFormData({ actual_cash: '', notes: '' }); setShowCloseForm(true); }}>Close Shift</Button>}
                    </>
                  }
                />
              ))}
            </AccentedList>
            <PaginationBar totalCount={shiftList.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="shifts" />
          </>
        )}
      </div>

      <Modal
        isOpen={showDetailModal}
        onClose={() => { setShowDetailModal(false); setDetailShiftId(null); }}
        title="Shift Detail"
        size="medium"
      >
        {shiftDetail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <p><strong>Shift #:</strong> {shiftDetail.shift_number}</p>
              <p><strong>Status:</strong> {shiftDetail.status}</p>
              <p><strong>Branch:</strong> {(shiftDetail as any).branch?.name ?? 'N/A'}</p>
              <p><strong>User:</strong> {(shiftDetail as any).user?.name ?? 'N/A'}</p>
              <p><strong>Opening cash:</strong> {formatCurrency(Number(shiftDetail.opening_cash))}</p>
              <p><strong>Expected Total:</strong> {shiftDetail.expected_cash != null ? formatCurrency(Number(shiftDetail.expected_cash)) : 'N/A'}</p>
              <p><strong>Cash collected:</strong> {shiftDetail.cash_collected != null ? formatCurrency(Number(shiftDetail.cash_collected)) : 'N/A'}</p>
              <p><strong>Card collected:</strong> {shiftDetail.card_collected != null ? formatCurrency(Number(shiftDetail.card_collected)) : 'N/A'}</p>
              <p><strong>Actual cash:</strong> {shiftDetail.actual_cash != null ? formatCurrency(Number(shiftDetail.actual_cash)) : 'N/A'}</p>
              <p><strong>Difference:</strong> {shiftDetail.difference != null ? formatCurrency(Number(shiftDetail.difference)) : 'N/A'}</p>
              <p><strong>Opened:</strong> {new Date(shiftDetail.opened_at).toLocaleString()}</p>
              <p><strong>Closed:</strong> {shiftDetail.closed_at ? new Date(shiftDetail.closed_at).toLocaleString() : 'N/A'}</p>
            </div>
            {shiftDetail.notes && <p className="text-sm text-gray-600"><strong>Notes:</strong> {shiftDetail.notes}</p>}
          </div>
        ) : detailShiftId ? (
          <Loader text="Loading..." />
        ) : null}
      </Modal>
    </div>
  );
};

export default Shifts;
