import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  MdCheck,
  MdAdd,
  MdClose,
  MdInfoOutline,
  MdReceiptLong,
  MdInventory2,
  MdNotificationsActive,
  MdNotificationsNone,
  MdVolumeUp,
  MdLocationOn,
} from 'react-icons/md';
import type { IconType } from 'react-icons';
import apiClient from '../../../utils/apiClient';
import { useHasPermission } from '../../../hooks/useHasPermission';
import {
  notificationsService,
  type NotificationEventCatalogItem,
  type NotificationSettingRow,
} from '../../../services/api/notificationsService';

type Role = { id: number; name: string; slug: string };
type Branch = { id: number; name: string };
type Brand = { id: number; name: string };

/** One configured scope (the tenant default, or a branch/brand override). */
type Scope = {
  key: string; // 'default' | `${branchId}:${brandId ?? 'all'}`
  settingId: number | null;
  branchId: number | null;
  brandId: number | null;
  enabled: boolean;
  sound: boolean;
  roleIds: number[];
  toDelete?: boolean;
  isNew?: boolean;
};

type EventState = {
  type: string;
  default: Scope;
  overrides: Scope[];
  dirty: boolean;
};

const GROUP_META: Record<
  string,
  { label: string; icon: IconType; color: string; tint: string }
> = {
  order: {
    label: 'Orders',
    icon: MdReceiptLong,
    color: 'text-blue-600',
    tint: 'bg-blue-50 dark:bg-blue-950/40',
  },
  inventory: {
    label: 'Inventory',
    icon: MdInventory2,
    color: 'text-amber-600',
    tint: 'bg-amber-50 dark:bg-amber-950/40',
  },
};
const GROUP_ORDER = ['order', 'inventory', 'hr'];
const groupMeta = (cat: string) =>
  GROUP_META[cat] ?? {
    label: cat.charAt(0).toUpperCase() + cat.slice(1),
    icon: MdNotificationsActive,
    color: 'text-slate-600',
    tint: 'bg-slate-100 dark:bg-slate-700',
  };

const surfaceTag = (surface: string) =>
  surface === 'pos_stack' ? 'POS' : surface === 'admin_bell' ? 'Bell' : surface;

// ───────────────────────── shared bits ─────────────────────────

const SwitchVisual: React.FC<{
  on: boolean;
  tone?: 'green' | 'red';
  size?: 'sm' | 'md';
}> = ({ on, tone = 'green', size = 'md' }) => {
  const d =
    size === 'md'
      ? { w: 'w-10', h: 'h-[23px]', k: 'w-[18px] h-[18px]', on: 'left-[19px]', off: 'left-[2.5px]' }
      : { w: 'w-[34px]', h: 'h-5', k: 'w-4 h-4', on: 'left-[16px]', off: 'left-[2px]' };
  const track = on
    ? tone === 'red'
      ? 'bg-red-600'
      : 'bg-green-600'
    : 'bg-slate-300 dark:bg-slate-600';
  return (
    <span className={`relative inline-block flex-none rounded-full ${d.w} ${d.h} ${track} transition-colors`}>
      <span className={`absolute top-1/2 -translate-y-1/2 rounded-full bg-white shadow transition-all ${d.k} ${on ? d.on : d.off}`} />
    </span>
  );
};

const RoleChip: React.FC<{
  active: boolean;
  label: string;
  onClick: () => void;
}> = ({ active, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-1.5 rounded-full border pl-2 pr-3 py-1.5 text-[13px] font-semibold transition-colors ${
      active
        ? 'border-red-600 bg-red-50 dark:bg-red-950/40 text-red-600'
        : 'border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-300 hover:border-red-300'
    }`}
  >
    <span
      className={`flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full border ${
        active ? 'border-red-600 bg-red-600' : 'border-slate-300 dark:border-slate-500'
      }`}
    >
      {active && <MdCheck className="h-2.5 w-2.5 text-white" />}
    </span>
    {label}
  </button>
);

// ───────────────────────── page ─────────────────────────

const NotificationSettings: React.FC = () => {
  const qc = useQueryClient();
  const canEdit = useHasPermission('notifications:edit');

  const settingsQ = useQuery({
    queryKey: ['notification-settings'],
    queryFn: notificationsService.getSettings,
  });
  const rolesQ = useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await apiClient.get<Role[]>('/admin/roles')).data ?? [],
  });
  const branchesQ = useQuery({
    queryKey: ['branches'],
    queryFn: async () =>
      (await apiClient.get<Branch[]>('/admin/branches')).data ?? [],
  });
  const brandsQ = useQuery({
    queryKey: ['brands'],
    queryFn: async () =>
      (await apiClient.get<Brand[]>('/admin/brands')).data ?? [],
  });

  const events = settingsQ.data?.events ?? [];
  const roles = rolesQ.data ?? [];
  const branches = branchesQ.data ?? [];
  const brands = brandsQ.data ?? [];

  const meta = useMemo(() => {
    const m: Record<string, NotificationEventCatalogItem> = {};
    for (const e of events) m[e.type] = e;
    return m;
  }, [events]);
  const roleName = useMemo(() => {
    const m = new Map(roles.map((r) => [r.id, r.name]));
    return (id: number) => m.get(id) ?? `Role ${id}`;
  }, [roles]);
  const branchName = (id: number | null) =>
    branches.find((b) => b.id === id)?.name ?? `Branch ${id}`;
  const brandName = (id: number | null) =>
    id == null ? 'All brands' : brands.find((b) => b.id === id)?.name ?? `Brand ${id}`;

  // Local editable state, hydrated from the server (and re-hydrated after save).
  const [state, setState] = useState<Record<string, EventState>>({});

  const build = (
    evs: NotificationEventCatalogItem[],
    rows: NotificationSettingRow[],
    rs: Role[],
  ): Record<string, EventState> => {
    const out: Record<string, EventState> = {};
    for (const ev of evs) {
      const evRows = rows.filter((s) => s.eventType === ev.type);
      const defRow = evRows.find((s) => s.branchId == null && s.brandId == null);
      const defaultRoleIds = defRow
        ? defRow.targetRoleIds
        : rs.filter((r) => ev.defaultRoleSlugs.includes(r.slug)).map((r) => r.id);
      out[ev.type] = {
        type: ev.type,
        default: {
          key: 'default',
          settingId: defRow?.id ?? null,
          branchId: null,
          brandId: null,
          enabled: defRow?.isEnabled ?? true,
          sound: defRow?.soundEnabled ?? ev.sound,
          roleIds: defaultRoleIds,
        },
        overrides: evRows
          .filter((s) => s.branchId != null)
          .map((s) => ({
            key: `${s.branchId}:${s.brandId ?? 'all'}`,
            settingId: s.id,
            branchId: s.branchId,
            brandId: s.brandId,
            enabled: s.isEnabled,
            sound: s.soundEnabled,
            roleIds: s.targetRoleIds,
          })),
        dirty: false,
      };
    }
    return out;
  };

  // Re-hydrate whenever the server data changes (initial load + post-save refetch).
  useEffect(() => {
    if (settingsQ.data && rolesQ.data) {
      setState(build(settingsQ.data.events, settingsQ.data.settings, rolesQ.data));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsQ.dataUpdatedAt, rolesQ.dataUpdatedAt]);

  // ── mutations ──
  const patchScope = (type: string, scopeKey: string, patch: Partial<Scope>) =>
    setState((prev) => {
      const ev = prev[type];
      if (!ev) return prev;
      if (scopeKey === 'default')
        return { ...prev, [type]: { ...ev, default: { ...ev.default, ...patch }, dirty: true } };
      return {
        ...prev,
        [type]: {
          ...ev,
          overrides: ev.overrides.map((o) => (o.key === scopeKey ? { ...o, ...patch } : o)),
          dirty: true,
        },
      };
    });

  const toggleRole = (type: string, scopeKey: string, roleId: number) =>
    setState((prev) => {
      const ev = prev[type];
      if (!ev) return prev;
      const apply = (sc: Scope): Scope => ({
        ...sc,
        roleIds: sc.roleIds.includes(roleId)
          ? sc.roleIds.filter((r) => r !== roleId)
          : [...sc.roleIds, roleId],
      });
      if (scopeKey === 'default')
        return { ...prev, [type]: { ...ev, default: apply(ev.default), dirty: true } };
      return {
        ...prev,
        [type]: {
          ...ev,
          overrides: ev.overrides.map((o) => (o.key === scopeKey ? apply(o) : o)),
          dirty: true,
        },
      };
    });

  const createOverride = (type: string, branchId: number, brandId: number | null) =>
    setState((prev) => {
      const ev = prev[type];
      if (!ev) return prev;
      const key = `${branchId}:${brandId ?? 'all'}`;
      if (ev.overrides.some((o) => o.key === key && !o.toDelete)) return prev;
      const nov: Scope = {
        key,
        settingId: null,
        branchId,
        brandId,
        enabled: true,
        sound: ev.default.sound,
        roleIds: [...ev.default.roleIds],
        isNew: true,
      };
      return { ...prev, [type]: { ...ev, overrides: [...ev.overrides, nov], dirty: true } };
    });

  const deleteOverride = (type: string, key: string) =>
    setState((prev) => {
      const ev = prev[type];
      if (!ev) return prev;
      const ov = ev.overrides.find((o) => o.key === key);
      const overrides = ov?.isNew
        ? ev.overrides.filter((o) => o.key !== key)
        : ev.overrides.map((o) => (o.key === key ? { ...o, toDelete: true } : o));
      return { ...prev, [type]: { ...ev, overrides, dirty: true } };
    });

  const saveM = useMutation({
    mutationFn: async () => {
      for (const ev of Object.values(state)) {
        if (!ev.dirty) continue;
        await notificationsService.upsertSetting({
          event_type: ev.type,
          branch_id: null,
          brand_id: null,
          target_role_ids: ev.default.roleIds,
          sound_enabled: ev.default.sound,
          is_enabled: ev.default.enabled,
        });
        for (const ov of ev.overrides) {
          if (ov.toDelete) {
            if (ov.settingId) await notificationsService.deleteSetting(ov.settingId);
            continue;
          }
          await notificationsService.upsertSetting({
            event_type: ev.type,
            branch_id: ov.branchId,
            brand_id: ov.brandId,
            target_role_ids: ov.roleIds,
            sound_enabled: ov.sound,
            is_enabled: ov.enabled,
          });
        }
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['notification-settings'] });
      toast.success('Notification settings saved');
    },
    onError: () => toast.error('Save failed — please retry'),
  });

  const discard = () => {
    if (settingsQ.data && rolesQ.data)
      setState(build(settingsQ.data.events, settingsQ.data.settings, rolesQ.data));
  };

  if (settingsQ.isLoading || rolesQ.isLoading) {
    return <div className="p-6 text-slate-500">Loading…</div>;
  }

  const dirtyCount = Object.values(state).filter((e) => e.dirty).length;

  // group events by category, ordered
  const cats = Array.from(new Set(events.map((e) => e.category))).sort(
    (a, b) =>
      (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99),
  );

  return (
    <div className="pb-28">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Notifications</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          Pick which role groups get alerted for each event. The{' '}
          <strong className="text-slate-700 dark:text-slate-200">tenant default</strong>{' '}
          applies to every branch — add a{' '}
          <strong className="text-slate-700 dark:text-slate-200">branch or brand override</strong>{' '}
          only where recipients should differ.
        </p>
      </div>

      <div className="mb-7 flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 p-3.5 dark:border-blue-900 dark:bg-blue-950/30">
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-blue-500 text-white">
          <MdInfoOutline className="h-4 w-4" />
        </span>
        <div className="text-[13.5px] leading-relaxed text-blue-900/80 dark:text-blue-200">
          <strong>How overrides work:</strong> a branch without its own override inherits the
          default recipients. An override replaces the recipient list for that branch (optionally
          narrowed to one brand) — nothing else.
        </div>
      </div>

      {cats.map((cat) => {
        const gm = groupMeta(cat);
        const GIcon = gm.icon;
        const groupEvents = events.filter((e) => e.category === cat);
        return (
          <div key={cat} className="mb-8">
            <div className="mb-3.5 flex items-center gap-2.5">
              <span className={`flex h-6 w-6 flex-none items-center justify-center rounded-md ${gm.tint} ${gm.color}`}>
                <GIcon className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {gm.label}
              </span>
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </div>

            <div className="flex flex-col gap-4">
              {groupEvents.map((ev) =>
                state[ev.type] ? (
                  <EventCard
                    key={ev.type}
                    meta={meta[ev.type]}
                    ev={state[ev.type]}
                    roles={roles}
                    branches={branches}
                    brands={brands}
                    roleName={roleName}
                    branchName={branchName}
                    brandName={brandName}
                    onToggleEnabled={() =>
                      patchScope(ev.type, 'default', {
                        enabled: !state[ev.type].default.enabled,
                      })
                    }
                    onToggleRole={(scopeKey, roleId) => toggleRole(ev.type, scopeKey, roleId)}
                    onToggleSound={(scopeKey, value) => patchScope(ev.type, scopeKey, { sound: value })}
                    onToggleScopeEnabled={(scopeKey, value) =>
                      patchScope(ev.type, scopeKey, { enabled: value })
                    }
                    onCreateOverride={(b, br) => createOverride(ev.type, b, br)}
                    onDeleteOverride={(key) => deleteOverride(ev.type, key)}
                  />
                ) : null,
              )}
            </div>
          </div>
        );
      })}

      {dirtyCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-4 border-t border-slate-200 bg-white px-6 py-3.5 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] dark:border-slate-700 dark:bg-slate-800 lg:left-[280px]">
          <div className="flex items-center gap-2.5 text-[13.5px] text-slate-600 dark:text-slate-300">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            Unsaved changes to{' '}
            <strong className="text-slate-800 dark:text-slate-100">{dirtyCount}</strong>{' '}
            event{dirtyCount > 1 ? 's' : ''}.
          </div>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={discard}
              disabled={saveM.isPending}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
            >
              Discard
            </button>
            {canEdit && <button
              type="button"
              onClick={() => saveM.mutate()}
              disabled={saveM.isPending}
              className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
            >
              {saveM.isPending ? 'Saving…' : 'Save all changes'}
            </button>}
          </div>
        </div>
      )}
    </div>
  );
};

// ───────────────────────── event card ─────────────────────────

const EventCard: React.FC<{
  meta: NotificationEventCatalogItem;
  ev: EventState;
  roles: Role[];
  branches: Branch[];
  brands: Brand[];
  roleName: (id: number) => string;
  branchName: (id: number | null) => string;
  brandName: (id: number | null) => string;
  onToggleEnabled: () => void;
  onToggleRole: (scopeKey: string, roleId: number) => void;
  onToggleSound: (scopeKey: string, value: boolean) => void;
  onToggleScopeEnabled: (scopeKey: string, value: boolean) => void;
  onCreateOverride: (branchId: number, brandId: number | null) => void;
  onDeleteOverride: (key: string) => void;
}> = ({
  meta,
  ev,
  roles,
  branches,
  brands,
  roleName,
  branchName,
  brandName,
  onToggleEnabled,
  onToggleRole,
  onToggleSound,
  onToggleScopeEnabled,
  onCreateOverride,
  onDeleteOverride,
}) => {
  const canEdit = useHasPermission('notifications:edit');
  const [adding, setAdding] = useState(false);
  const [branchSel, setBranchSel] = useState<number | ''>('');
  const [brandSel, setBrandSel] = useState<number | ''>('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const enabled = ev.default.enabled;
  const tags = [meta.category.charAt(0).toUpperCase() + meta.category.slice(1), surfaceTag(meta.surface)];
  const visibleOverrides = ev.overrides.filter((o) => !o.toDelete);
  const duplicate = (b: number, br: number | '') =>
    ev.overrides.some(
      (o) => !o.toDelete && o.branchId === b && (o.brandId ?? '') === (br === '' ? null : br),
    );

  const ChannelsRow: React.FC<{ scope: Scope }> = ({ scope }) => (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 pt-3.5 dark:border-slate-700/60">
      <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">Channels</span>
      <span className="flex items-center gap-2" title="Every notification shows in-app">
        <SwitchVisual on tone="green" size="sm" />
        <span className="flex items-center gap-1.5 text-[13px] text-slate-600 dark:text-slate-300">
          <MdNotificationsNone className="h-4 w-4" /> In-app
        </span>
      </span>
      {meta.sound && (
        <button
          type="button"
          onClick={() => onToggleSound(scope.key, !scope.sound)}
          className="flex items-center gap-2"
        >
          <SwitchVisual on={scope.sound} tone="red" size="sm" />
          <span
            className={`flex items-center gap-1.5 text-[13px] ${
              scope.sound ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            <MdVolumeUp className="h-4 w-4" /> Sound
          </span>
        </button>
      )}
    </div>
  );

  const RoleGrid: React.FC<{ scope: Scope }> = ({ scope }) => (
    <div className="flex flex-wrap gap-2">
      {roles.map((r) => (
        <RoleChip
          key={r.id}
          active={scope.roleIds.includes(r.id)}
          label={r.name}
          onClick={() => onToggleRole(scope.key, r.id)}
        />
      ))}
    </div>
  );

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-white dark:bg-slate-800 ${
        enabled ? 'border-slate-200 dark:border-slate-700' : 'border-slate-200/70 opacity-60 dark:border-slate-700/70'
      }`}
    >
      {/* header */}
      <div className="flex items-start justify-between gap-5 px-5 pb-4 pt-[18px]">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-base font-bold text-slate-800 dark:text-slate-100">{meta.label}</span>
            {tags.map((t) => (
              <span
                key={t}
                className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300"
              >
                {t}
              </span>
            ))}
          </div>
          <div className="mt-1.5 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">
            {meta.description}
          </div>
        </div>
        <button type="button" onClick={onToggleEnabled} className="flex flex-none items-center gap-2.5 py-1">
          <span className={`text-xs font-semibold ${enabled ? 'text-green-600' : 'text-slate-400'}`}>
            {enabled ? 'On' : 'Off'}
          </span>
          <SwitchVisual on={enabled} tone="green" />
        </button>
      </div>

      {/* default recipients */}
      <div className="px-5 pb-4">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[11.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Default recipients — all branches
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {ev.default.roleIds.length} selected
          </span>
        </div>
        <div className="mb-4">
          <RoleGrid scope={ev.default} />
        </div>
        <ChannelsRow scope={ev.default} />
      </div>

      {/* overrides */}
      {visibleOverrides.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-3.5 dark:border-slate-700/60 dark:bg-slate-800/40">
          <div className="mb-2.5 text-[11.5px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Overrides
          </div>
          <div className="flex flex-col gap-2">
            {visibleOverrides.map((ov) => (
              <div
                key={ov.key}
                className="rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
              >
                <div className="flex items-center justify-between gap-4 p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950/40">
                      <MdLocationOn className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-slate-800 dark:text-slate-100">
                        {branchName(ov.branchId)} · {brandName(ov.brandId)}
                        {ov.isNew && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                            new
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-slate-400 dark:text-slate-500">
                        {ov.roleIds.length
                          ? ov.roleIds.map(roleName).join(', ')
                          : 'No recipients'}
                        {!ov.enabled && ' · disabled'}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === ov.key ? null : ov.key)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                    >
                      {expanded === ov.key ? 'Done' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteOverride(ov.key)}
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-900 dark:bg-slate-700"
                      title="Remove override"
                    >
                      <MdClose className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {expanded === ov.key && (
                  <div className="border-t border-slate-100 p-3 dark:border-slate-700/60">
                    <RoleGrid scope={ov} />
                    <div className="mt-3 flex items-center gap-5">
                      <button
                        type="button"
                        onClick={() => onToggleScopeEnabled(ov.key, !ov.enabled)}
                        className="flex items-center gap-2"
                      >
                        <SwitchVisual on={ov.enabled} tone="green" size="sm" />
                        <span className="text-[13px] text-slate-600 dark:text-slate-300">Enabled</span>
                      </button>
                      {meta.sound && (
                        <button
                          type="button"
                          onClick={() => onToggleSound(ov.key, !ov.sound)}
                          className="flex items-center gap-2"
                        >
                          <SwitchVisual on={ov.sound} tone="red" size="sm" />
                          <span className="text-[13px] text-slate-600 dark:text-slate-300">Sound</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* add override footer */}
      <div className="border-t border-slate-100 bg-slate-50 dark:border-slate-700/60 dark:bg-slate-800/40">
        {adding ? (
          <div className="flex flex-wrap items-end gap-3.5 px-5 py-4">
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-500">
              Branch
              <select
                value={branchSel}
                onChange={(e) => setBranchSel(e.target.value ? Number(e.target.value) : '')}
                className="min-w-[170px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13.5px] font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
              >
                <option value="">Select branch…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-500">
              Brand <span className="font-medium text-slate-400">(optional)</span>
              <select
                value={brandSel}
                onChange={(e) => setBrandSel(e.target.value ? Number(e.target.value) : '')}
                className="min-w-[150px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13.5px] font-semibold text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
              >
                <option value="">All brands</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={branchSel === '' || duplicate(Number(branchSel), brandSel)}
              onClick={() => {
                onCreateOverride(Number(branchSel), brandSel === '' ? null : Number(brandSel));
                setExpanded(`${Number(branchSel)}:${brandSel === '' ? 'all' : Number(brandSel)}`);
                setAdding(false);
                setBranchSel('');
                setBrandSel('');
              }}
              className="rounded-lg bg-slate-800 px-4 py-2.5 text-[13.5px] font-semibold text-white hover:bg-slate-900 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              Create override
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="px-3 py-2.5 text-[13.5px] font-semibold text-slate-500 hover:underline"
            >
              Cancel
            </button>
          </div>
        ) : canEdit ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-2 px-5 py-3 text-left text-[13.5px] font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
          >
            <MdAdd className="h-4 w-4" /> Add branch or brand override
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default NotificationSettings;
