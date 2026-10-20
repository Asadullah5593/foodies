import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdDelete, MdEdit } from 'react-icons/md';
import type { PushAudienceSpec, PushMeta, PushSavedAudience } from '../../../types';
import { pushService } from '../../../services/api';
import { confirmDialog } from '../../../utils/sweetAlert';
import Modal from '../../../components/Modal';
import { cu } from '../customersUi';
import AudienceBuilder, { AudienceCounts } from './AudienceBuilder';
import { audienceSummary } from './pushText';

const EMPTY: PushAudienceSpec = { match: 'all', include: [], exclude: [] };

function errorText(e: unknown): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong';
}

/** Saved, named audiences — reused by notifications, which read their current rules at every send. */
const AudiencesTab: React.FC<{ meta: PushMeta | undefined; canSend: boolean }> = ({ meta, canSend }) => {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['push-audiences'], queryFn: pushService.audiences });
  const [editing, setEditing] = useState<{ id?: number; name: string; description: string; rules: PushAudienceSpec } | null>(null);

  const save = useMutation({
    mutationFn: () =>
      pushService.saveAudience({ name: editing!.name.trim(), description: editing!.description.trim() || null, rules: editing!.rules }, editing!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['push-audiences'] });
      toast.success('Audience saved');
      setEditing(null);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => pushService.deleteAudience(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['push-audiences'] });
      toast.success('Audience deleted');
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const open = (a?: PushSavedAudience) =>
    setEditing(a ? { id: a.id, name: a.name, description: a.description ?? '', rules: a.rules } : { name: '', description: '', rules: EMPTY });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className={`max-w-[720px] text-[13px] ${cu.muted}`}>
          Name an audience once and reuse it. A notification that uses one reads its rules again at every send, so editing an audience updates the repeating
          notifications that use it.
        </p>
        {canSend && (
          <button type="button" className={cu.btnPrimary} onClick={() => open()}>
            + New audience
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="py-10 text-center text-gray-500">Loading…</p>
      ) : data.length === 0 ? (
        <div className="rounded-2xl border-[1.5px] border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center dark:border-slate-600 dark:bg-slate-800/50">
          <p className={`text-[15px] font-semibold ${cu.strong}`}>No saved audiences</p>
          <p className={`mt-1 text-[13px] ${cu.muted}`}>For example "Lapsed Wok & Go regulars" or "Lives near Gulberg".</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((a) => (
            <div key={a.id} className={`${cu.card} flex flex-col justify-between rounded-[16px] p-4`}>
              <div>
                <div className="flex items-start justify-between gap-2">
                  <p className={`text-[15px] font-bold ${cu.strong}`}>{a.name}</p>
                  {canSend && (
                    <div className="flex flex-none gap-1">
                      <button type="button" onClick={() => open(a)} aria-label={`Edit ${a.name}`} className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300">
                        <MdEdit size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${a.name}`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-700 dark:bg-slate-700 dark:text-slate-300"
                        onClick={async () => {
                          if (
                            await confirmDialog({
                              title: `Delete "${a.name}"?`,
                              text: a.used_by ? `${a.used_by} scheduled notification(s) use it; they keep a copy of its current rules.` : undefined,
                              confirmText: 'Delete',
                            })
                          )
                            remove.mutate(a.id);
                        }}
                      >
                        <MdDelete size={14} />
                      </button>
                    </div>
                  )}
                </div>
                {a.description && <p className={`mt-0.5 text-[12.5px] ${cu.muted}`}>{a.description}</p>}
                <p className={`mt-2 text-[12.5px] ${cu.text}`}>{audienceSummary(a.rules, meta)}</p>
              </div>
              <div className="mt-3">
                <AudienceCounts audienceId={a.id} compact />
                <div className="mt-2 flex items-center justify-between">
                  <span className={`text-[11.5px] ${cu.muted}`}>{a.used_by ? `Used by ${a.used_by} scheduled` : 'Not in use'}</span>
                  {canSend && (
                    <Link to={`/admin/push-notifications/new?audience=${a.id}`} className="text-[12.5px] font-semibold text-red-600 hover:underline">
                      Send to them →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit audience' : 'New audience'} size="xlarge">
        {editing && meta && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className={cu.fieldLabel}>Name</span>
                <input className={cu.input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Lapsed Wok & Go regulars" />
              </label>
              <label>
                <span className={cu.fieldLabel}>Note (optional)</span>
                <input className={cu.input} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </label>
            </div>
            <AudienceBuilder meta={meta} value={editing.rules} onChange={(rules) => setEditing({ ...editing, rules })} />
            <AudienceCounts meta={meta} audience={editing.rules} />
            <div className="flex justify-end gap-2">
              <button type="button" className={cu.btnOutline} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="button" className={cu.btnPrimary} disabled={!editing.name.trim() || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? 'Saving…' : 'Save audience'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AudiencesTab;
