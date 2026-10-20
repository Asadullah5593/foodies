import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdDelete, MdEdit } from 'react-icons/md';
import type { PushMeta, PushTemplate } from '../../../types';
import { pushService } from '../../../services/api';
import { confirmDialog } from '../../../utils/sweetAlert';
import Modal from '../../../components/Modal';
import { cu } from '../customersUi';
import PhonePreview from './PhonePreview';

function errorText(e: unknown): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Something went wrong';
}

/** Saved messages to start a new notification from. */
const TemplatesTab: React.FC<{ meta: PushMeta | undefined; canSend: boolean }> = ({ meta, canSend }) => {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ['push-templates'], queryFn: pushService.templates });
  const [editing, setEditing] = useState<{ id?: number; name: string; title: string; body: string; image_url: string } | null>(null);
  const save = useMutation({
    mutationFn: () =>
      pushService.saveTemplate(
        { name: editing!.name.trim(), title: editing!.title.trim(), body: editing!.body.trim(), image_url: editing!.image_url.trim() || null },
        editing!.id,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['push-templates'] });
      toast.success('Template saved');
      setEditing(null);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => pushService.deleteTemplate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['push-templates'] });
      toast.success('Template deleted');
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const open = (t?: PushTemplate) =>
    setEditing(t ? { id: t.id, name: t.name, title: t.title, body: t.body, image_url: t.imageUrl ?? '' } : { name: '', title: '', body: '', image_url: '' });
  const tokens = meta?.personal_tokens ?? [];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className={`text-[13px] ${cu.muted}`}>Messages you send often. Start a notification from one and change what you need.</p>
        {canSend && (
          <button type="button" className={cu.btnPrimary} onClick={() => open()}>
            + New template
          </button>
        )}
      </div>
      {isLoading ? (
        <p className="py-10 text-center text-gray-500">Loading…</p>
      ) : data.length === 0 ? (
        <div className="rounded-2xl border-[1.5px] border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center dark:border-slate-600 dark:bg-slate-800/50">
          <p className={`text-[15px] font-semibold ${cu.strong}`}>No templates yet</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((t) => (
            <div key={t.id} className={`${cu.card} flex flex-col justify-between rounded-[16px] p-4`}>
              <div>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className={`text-[15px] font-bold ${cu.strong}`}>{t.name}</p>
                  {canSend && (
                    <div className="flex flex-none gap-1">
                      <button type="button" onClick={() => open(t)} aria-label={`Edit ${t.name}`} className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300">
                        <MdEdit size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${t.name}`}
                        className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-red-100 hover:text-red-700 dark:bg-slate-700 dark:text-slate-300"
                        onClick={async () => {
                          if (await confirmDialog({ title: `Delete "${t.name}"?`, confirmText: 'Delete' })) remove.mutate(t.id);
                        }}
                      >
                        <MdDelete size={14} />
                      </button>
                    </div>
                  )}
                </div>
                <p className={`text-[13px] font-semibold ${cu.text}`}>{t.title}</p>
                <p className={`line-clamp-3 text-[12.5px] ${cu.soft}`}>{t.body}</p>
              </div>
              {canSend && (
                <Link to={`/admin/push-notifications/new?template=${t.id}`} className="mt-3 text-right text-[12.5px] font-semibold text-red-600 hover:underline">
                  Use it →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit template' : 'New template'} size="large">
        {editing && (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
            <div className="space-y-3">
              <label className="block">
                <span className={cu.fieldLabel}>Template name</span>
                <input className={cu.input} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </label>
              <label className="block">
                <span className={cu.fieldLabel}>Title</span>
                <input className={cu.input} maxLength={meta?.limits.title ?? 120} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </label>
              <label className="block">
                <span className={cu.fieldLabel}>Message</span>
                <textarea className={`${cu.input} min-h-[96px]`} maxLength={meta?.limits.body ?? 1000} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
              </label>
              <label className="block">
                <span className={cu.fieldLabel}>Image link (optional · Android only)</span>
                <input className={cu.input} value={editing.image_url} onChange={(e) => setEditing({ ...editing, image_url: e.target.value })} placeholder="https://…" />
              </label>
              <p className={`text-[11.5px] ${cu.muted}`}>Placeholders work here too: {tokens.map((t) => `{${t.key}}`).join(' ')}</p>
              <div className="flex justify-end gap-2">
                <button type="button" className={cu.btnOutline} onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={cu.btnPrimary}
                  disabled={!editing.name.trim() || !editing.title.trim() || !editing.body.trim() || save.isPending}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? 'Saving…' : 'Save template'}
                </button>
              </div>
            </div>
            <PhonePreview title={editing.title} body={editing.body} imageUrl={editing.image_url || null} tokens={tokens} />
          </div>
        )}
      </Modal>
    </div>
  );
};

export default TemplatesTab;
