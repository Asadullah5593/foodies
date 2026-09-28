import React from 'react';
import type {
  ActivityLogDetail,
  ActivityLogRelated,
  ActivityLogRow,
} from '../../services/api/activityLogService';
import {
  ACTOR_STYLES,
  OUTCOME_HINTS,
  OUTCOME_STYLES,
  actorTypeLabel,
  areaLabel,
  describeActivity,
  describeDevice,
  fieldLabel,
  hasRecord,
  recordTypeLabel,
  formatWhen,
  outcomeLabel,
  relativeWhen,
} from './activityLogText';

const SECTION = 'rounded-2xl border border-[#ECEDF0] bg-white p-5';
const HEADING = 'mb-3 text-[13px] font-bold text-[#20242C]';
const TERM = 'text-[13px] text-[#6B7280]';
const VALUE = 'text-[13.5px] font-medium text-[#20242C]';

/** Renders a value, keeping `[redacted]` visibly removed rather than absent. */
const DiffValue: React.FC<{ value: unknown }> = ({ value }) => {
  if (value === null || value === undefined || value === '') {
    return <span className="text-gray-400">empty</span>;
  }
  if (typeof value === 'boolean') {
    return <span className="text-[13px]">{value ? 'Yes' : 'No'}</span>;
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (text === '[redacted]' || text === '[changed]') {
    return (
      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
        {text}
      </span>
    );
  }
  return <span className="break-words text-[13px]">{text}</span>;
};

/**
 * A set-valued change (a role's permissions, most importantly) read as what was
 * added and removed. Two 119-item JSON blobs side by side are technically the
 * same information and practically unreadable — this is the difference between
 * "the permissions changed" and "they granted themselves refunds".
 */
const SetDiff: React.FC<{ before: unknown[]; after: unknown[] }> = ({ before, after }) => {
  const beforeSet = before.map(String);
  const afterSet = after.map(String);
  const added = afterSet.filter((v) => !beforeSet.includes(v));
  const removed = beforeSet.filter((v) => !afterSet.includes(v));

  if (!added.length && !removed.length) {
    return <span className="text-xs text-gray-400">reordered only</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {added.map((v) => (
        <span
          key={`+${v}`}
          className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700"
        >
          + {v}
        </span>
      ))}
      {removed.map((v) => (
        <span
          key={`-${v}`}
          className="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-rose-700"
        >
          − {v}
        </span>
      ))}
    </div>
  );
};

/** The payload as a list of named values; nesting falls back to compact JSON. */
const PayloadList: React.FC<{ payload: Record<string, unknown> }> = ({ payload }) => (
  <dl className="grid grid-cols-[minmax(120px,auto),1fr] gap-x-4 gap-y-2">
    {Object.entries(payload).map(([key, value]) => (
      <React.Fragment key={key}>
        <dt className={TERM}>{fieldLabel(key)}</dt>
        <dd className="min-w-0">
          {Array.isArray(value) && value.every((v) => typeof v !== 'object') ? (
            <DiffValue value={value.join(', ')} />
          ) : (
            <DiffValue value={value} />
          )}
        </dd>
      </React.Fragment>
    ))}
  </dl>
);

const Technical: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <>
    <dt className="text-[12px] text-[#6B7280]">{label}</dt>
    <dd className="min-w-0 break-all font-mono text-[12px] text-[#374151]">{children}</dd>
  </>
);

interface Props {
  selected: ActivityLogRow;
  detail?: ActivityLogDetail;
  related?: ActivityLogRelated[];
  branchName?: string | null;
  brandName?: string | null;
  onClose: () => void;
  /** Narrows the list to everything that came from one address. */
  onShowIp: (ip: string) => void;
  /** Opens the full history of the record this entry is about. */
  onShowRecord?: () => void;
}

/**
 * One entry in full. Ordered by what a reader asks, in the order they ask it:
 * what happened, who did it, where from, what changed. Everything a developer
 * would want — route, request id, raw payload — is kept, folded away at the
 * bottom so it does not stand between the reader and the answer.
 */
const ActivityLogDetails: React.FC<Props> = ({
  selected,
  detail,
  related,
  branchName,
  brandName,
  onClose,
  onShowIp,
  onShowRecord,
}) => {
  const device = describeDevice(detail?.user_agent);
  const others = (related ?? []).filter((r) => r.id !== selected.id);
  const payload =
    detail?.request_body && Object.keys(detail.request_body).length > 0
      ? detail.request_body
      : null;
  const query =
    detail?.query && Object.keys(detail.query).length > 0 ? detail.query : null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Activity details"
        className="h-full w-full max-w-2xl overflow-y-auto bg-[#F7F8FA] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-[#ECEDF0] bg-white px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <span
                title={OUTCOME_HINTS[selected.outcome]}
                className={`inline-block rounded-full border px-2.5 py-0.5 text-[12px] font-bold ${
                  OUTCOME_STYLES[selected.outcome] ??
                  'border-gray-200 bg-gray-50 text-gray-600'
                }`}
              >
                {outcomeLabel(selected.outcome)}
              </span>
              <h2 className="mt-2 text-[20px] font-extrabold leading-snug tracking-[-0.01em] text-[#20242C]">
                {describeActivity(selected)}
              </h2>
              <div className="mt-1.5 text-[13.5px] text-[#4B5563]">
                {formatWhen(selected.created_at, true)}
                <span className="text-[#9AA1AD]"> · {relativeWhen(selected.created_at)}</span>
              </div>
              {selected.summary && (
                <p className="mt-2 text-[13px] text-[#4B5563]">{selected.summary}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex-none rounded-lg px-3 py-1 text-xl leading-none text-[#6B7280] transition hover:bg-[#F3F4F6]"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <section className={SECTION}>
            <h3 className={HEADING}>Who</h3>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#F3F4F6] text-sm font-bold text-[#5A6473]">
                {(selected.actor_label ?? '?').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold text-[#20242C]">
                  {selected.actor_label ?? 'Unknown'}
                  <span
                    className={`ml-2 rounded px-1.5 py-0.5 align-middle text-[11px] font-semibold ${
                      ACTOR_STYLES[selected.actor_type] ?? 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {actorTypeLabel(selected.actor_type)}
                  </span>
                </div>
                {/* Labelled explicitly: roles are edited over time, so
                    today's role is the wrong answer for a past action. */}
                <dl className="mt-2 grid grid-cols-[minmax(120px,auto),1fr] gap-x-4 gap-y-1.5">
                  <dt className={TERM}>Role at the time</dt>
                  <dd className={VALUE}>
                    {selected.actor_role_names?.length
                      ? selected.actor_role_names.join(', ')
                      : selected.actor_is_super_admin
                        ? 'Super admin (unrestricted)'
                        : 'None recorded'}
                  </dd>
                </dl>
              </div>
            </div>
          </section>

          {hasRecord(selected) && (
            <section className={SECTION}>
              <h3 className={HEADING}>Record</h3>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-bold text-[#20242C]">
                    {selected.entity_label ?? `#${selected.entity_id}`}
                  </div>
                  {selected.entity_type && (
                    <div className="mt-0.5 text-[13px] text-[#6B7280]">
                      {recordTypeLabel(selected.entity_type)}
                      {selected.entity_id ? ` #${selected.entity_id}` : ''}
                    </div>
                  )}
                </div>
                {onShowRecord && selected.entity_type && selected.entity_id && (
                  <button
                    type="button"
                    onClick={onShowRecord}
                    className="rounded-lg border border-[#E2E5EA] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#374151] transition hover:bg-[#F3F4F6]"
                  >
                    Show full history of this record
                  </button>
                )}
              </div>
            </section>
          )}

          <section className={SECTION}>
            <h3 className={HEADING}>Where</h3>
            <dl className="grid grid-cols-[minmax(120px,auto),1fr] items-center gap-x-4 gap-y-2">
              <dt className={TERM}>Branch</dt>
              <dd className={VALUE}>{branchName ?? 'Not tied to a branch'}</dd>
              <dt className={TERM}>Brand</dt>
              <dd className={VALUE}>{brandName ?? 'Not tied to a brand'}</dd>
              <dt className={TERM}>IP address</dt>
              <dd className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-[14px] font-semibold text-[#20242C]">
                  {selected.ip ?? 'Not recorded'}
                </span>
                {selected.ip && (
                  <button
                    type="button"
                    onClick={() => onShowIp(selected.ip!)}
                    className="rounded-lg border border-[#E2E5EA] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#374151] transition hover:bg-[#F3F4F6]"
                  >
                    Show all activity from this address
                  </button>
                )}
              </dd>
              <dt className={TERM}>Device</dt>
              <dd className={VALUE} title={detail?.user_agent ?? undefined}>
                {detail ? (device ?? 'Not recorded') : '…'}
              </dd>
            </dl>
          </section>

          {detail?.changes && (
            <section className={SECTION}>
              <h3 className={HEADING}>What changed</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#F1F2F5] text-left text-[12px] font-semibold text-[#6B7280]">
                    <th className="py-1.5 pr-3">Field</th>
                    <th className="py-1.5 pr-3">Before</th>
                    <th className="py-1.5">After</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(detail.changes).map(([field, value]) => {
                    const isSet =
                      Array.isArray(value.before) && Array.isArray(value.after);
                    return (
                      <tr key={field} className="border-b border-gray-100 last:border-0">
                        <td
                          className="py-2 pr-3 align-top text-[13px] font-semibold text-[#374151]"
                          title={field}
                        >
                          {fieldLabel(field)}
                        </td>
                        {isSet ? (
                          <td className="py-2" colSpan={2}>
                            <SetDiff
                              before={value.before as unknown[]}
                              after={value.after as unknown[]}
                            />
                          </td>
                        ) : (
                          <>
                            <td className="py-2 pr-3 align-top text-[#6B7280]">
                              <DiffValue value={value.before} />
                            </td>
                            <td className="py-2 align-top font-medium text-[#20242C]">
                              <DiffValue value={value.after} />
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {!detail?.changes && selected.diff_expected && (
            <section className="rounded-2xl border border-dashed border-[#E2E5EA] bg-white p-4 text-[13px] text-[#6B7280]">
              This route should record a before/after, but none was captured —
              missing instrumentation rather than an unchanged record.
            </section>
          )}

          {payload && (
            <section className={SECTION}>
              <h3 className={HEADING}>
                What was sent
                {detail?.payload_truncated && (
                  <span className="ml-2 font-normal text-[#6B7280]">(truncated)</span>
                )}
              </h3>
              <PayloadList payload={payload} />
            </section>
          )}

          {others.length > 0 && (
            <section className={SECTION}>
              <h3 className={HEADING}>Also part of this request</h3>
              <ul className="space-y-1.5">
                {others.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-[#F7F8FA] px-3 py-2 text-[13px]"
                  >
                    <span className="text-[#374151]">{describeActivity(r)}</span>
                    <span
                      className={`flex-none rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                        OUTCOME_STYLES[r.outcome] ??
                        'border-gray-200 bg-gray-50 text-gray-600'
                      }`}
                    >
                      {outcomeLabel(r.outcome)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <details className={SECTION}>
            <summary className="cursor-pointer select-none text-[13px] font-bold text-[#20242C]">
              Technical details
            </summary>
            <dl className="mt-3 grid grid-cols-[minmax(120px,auto),1fr] gap-x-4 gap-y-1.5">
              <Technical label="Action code">{selected.action}</Technical>
              <Technical label="Area">{areaLabel(selected.action_group)}</Technical>
              {selected.route && (
                <Technical label="Route">
                  {selected.http_method} {selected.route}
                </Technical>
              )}
              {selected.status_code != null && (
                <Technical label="Status code">{selected.status_code}</Technical>
              )}
              {selected.duration_ms != null && (
                <Technical label="Took">{selected.duration_ms} ms</Technical>
              )}
              <Technical label="Request ID">{selected.request_id ?? '—'}</Technical>
              {detail?.session_id && (
                <Technical label="Session">{detail.session_id}</Technical>
              )}
              {detail?.device_id && (
                <Technical label="Device ID">{detail.device_id}</Technical>
              )}
              {detail?.user_agent && (
                <Technical label="Browser string">{detail.user_agent}</Technical>
              )}
            </dl>
            {query && (
              <>
                <div className="mb-1 mt-4 text-[12px] text-[#6B7280]">Query</div>
                <pre className="overflow-x-auto rounded-xl bg-[#20242C] p-3.5 text-[12px] leading-relaxed text-gray-100">
                  {JSON.stringify(query, null, 2)}
                </pre>
              </>
            )}
            {payload && (
              <>
                <div className="mb-1 mt-4 text-[12px] text-[#6B7280]">Raw payload</div>
                <pre className="overflow-x-auto rounded-xl bg-[#20242C] p-3.5 text-[12px] leading-relaxed text-gray-100">
                  {JSON.stringify(payload, null, 2)}
                </pre>
              </>
            )}
          </details>
        </div>
      </div>
    </div>
  );
};

export default ActivityLogDetails;
