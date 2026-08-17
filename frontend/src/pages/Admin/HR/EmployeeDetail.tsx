import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MdArrowBack, MdOutlineHistory, MdOutlineLock } from 'react-icons/md';
import { hrService } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import Loader from '../../../components/Loader';
import ChangeAssignmentModal from './ChangeAssignmentModal';
import RecordExitModal from './RecordExitModal';
import {
  CHANGE_REASON_LABELS,
  canSeeSalary,
  eventTone,
  statusBadgeClass,
  statusLabel,
} from './hrShared';

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <dt className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</dt>
    <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">{value ?? '—'}</dd>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode; action?: React.ReactNode }> = ({
  title,
  children,
  action,
}) => (
  <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
        {title}
      </h2>
      {action}
    </div>
    {children}
  </section>
);

/**
 * Employee 360 — the "complete history in one place" screen.
 *
 * The timeline comes from `employee_events`, which every HR module appends to,
 * so this page is one query rather than a union across assignments, reviews,
 * training and payroll.
 */
const EmployeeDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const employeeId = Number(id);
  const canEdit = useHasPermission('employees:edit');
  const canTerminate = useHasPermission('employees:terminate');

  const [showAssignment, setShowAssignment] = useState(false);
  const [showExit, setShowExit] = useState(false);

  const { data: employee, isLoading, isError } = useQuery({
    queryKey: ['hr-employee', employeeId],
    queryFn: () => hrService.getEmployee(employeeId),
    enabled: Number.isFinite(employeeId),
  });

  const { data: designations = [] } = useQuery({
    queryKey: ['hr-designations'],
    queryFn: () => hrService.listDesignations(),
  });

  const { data: exit } = useQuery({
    queryKey: ['hr-employee-exit', employeeId],
    queryFn: () => hrService.getExit(employeeId),
    enabled: Number.isFinite(employeeId),
  });

  if (isLoading) return <Loader />;
  if (isError || !employee) {
    return (
      <div className="p-6">
        <p className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          Could not load this employee.
        </p>
      </div>
    );
  }

  const hasLeft = ['resigned', 'terminated'].includes(employee.status);
  const showSalary = canSeeSalary(employee);
  const current = employee.current_assignment;

  return (
    <div className="p-4 md:p-6">
      <Link
        to="/admin/hr/employees"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        <MdArrowBack /> Back to employees
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {employee.full_name}
            </h1>
            <span className={statusBadgeClass(employee.status)}>
              {statusLabel(employee.status)}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {employee.employee_code}
            {current?.designation && ` · ${current.designation.name}`}
            {current?.branch?.name && ` · ${current.branch.name}`}
            {current && !current.brand?.name && ' · Shared (no brand)'}
          </p>
        </div>

        <div className="flex gap-2">
          {canEdit && !hasLeft && (
            <button
              type="button"
              onClick={() => setShowAssignment(true)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
            >
              Promote / transfer
            </button>
          )}
          {canTerminate && !hasLeft && (
            <button
              type="button"
              onClick={() => setShowExit(true)}
              className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Record exit
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Profile">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Father's name" value={employee.father_name} />
              <Field label="CNIC" value={employee.cnic} />
              <Field label="Phone" value={employee.phone} />
              <Field label="Date of birth" value={employee.date_of_birth} />
              <Field label="Joined" value={employee.date_of_joining} />
              <Field label="Employment type" value={employee.employment_type.replace('_', ' ')} />
              <Field label="Probation ends" value={employee.probation_end_date} />
              <Field label="Confirmed on" value={employee.confirmation_date} />
              <Field
                label="Emergency contact"
                value={
                  employee.emergency_contact_name
                    ? `${employee.emergency_contact_name} · ${employee.emergency_contact_phone ?? ''}`
                    : null
                }
              />
            </dl>
          </Section>

          {/*
            The bank block is absent — not blank — for anyone without
            salary:view. The server omits the keys entirely, so there is nothing
            to leak into the DOM for a branch manager to read.
          */}
          {showSalary ? (
            <Section title="Payment details">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Method" value={employee.payment_method?.replace('_', ' ')} />
                <Field label="Bank" value={employee.bank_name} />
                <Field label="Account title" value={employee.account_title} />
                <Field label="Account / IBAN" value={employee.account_number_iban} />
              </dl>
            </Section>
          ) : (
            <Section title="Payment details">
              <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <MdOutlineLock /> Salary and bank details need the{' '}
                <code className="rounded bg-gray-100 px-1 dark:bg-slate-700">salary:view</code>{' '}
                permission.
              </p>
            </Section>
          )}

          <Section title="Employment history">
            {employee.assignments.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No assignments recorded.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                      <th className="py-2 pr-4">Period</th>
                      <th className="py-2 pr-4">Designation</th>
                      <th className="py-2 pr-4">Branch</th>
                      <th className="py-2 pr-4">Brand</th>
                      <th className="py-2 pr-4">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                    {employee.assignments.map((a) => (
                      <tr key={a.id} className={a.is_current ? 'font-medium' : ''}>
                        <td className="whitespace-nowrap py-2 pr-4 text-gray-700 dark:text-gray-300">
                          {a.effective_from} → {a.effective_to ?? 'present'}
                        </td>
                        <td className="py-2 pr-4">{a.designation?.name ?? '—'}</td>
                        <td className="py-2 pr-4">{a.branch.name ?? '—'}</td>
                        <td className="py-2 pr-4">
                          {a.brand?.name ?? <span className="italic text-gray-400">Shared</span>}
                        </td>
                        <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">
                          {CHANGE_REASON_LABELS[a.change_reason] ?? a.change_reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {exit && (
            <Section title="Exit &amp; clearance">
              <dl className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Field label="Type" value={exit.exit_type.replace('_', ' ')} />
                <Field label="Last working day" value={exit.last_working_date} />
                <Field label="Notice period" value={`${exit.notice_period_days} days`} />
                <Field label="Rehire eligible" value={exit.rehire_eligible ? 'Yes' : 'No'} />
              </dl>
              <ul className="space-y-2">
                {exit.clearance_items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 text-sm dark:border-slate-700"
                  >
                    <span className="text-gray-800 dark:text-gray-200">{item.description}</span>
                    <span
                      className={
                        item.status === 'cleared'
                          ? 'text-green-600 dark:text-green-400'
                          : item.status === 'withheld'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-gray-500 dark:text-gray-400'
                      }
                    >
                      {item.status.replace('_', ' ')}
                    </span>
                  </li>
                ))}
              </ul>
              {exit.settled_at == null && (
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  Final settlement is calculated with payroll (Phase 4) and is still pending.
                </p>
              )}
            </Section>
          )}
        </div>

        <div className="space-y-4">
          <Section title="Timeline">
            {employee.timeline.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Nothing recorded yet.</p>
            ) : (
              <ol className="space-y-3">
                {employee.timeline.map((e) => (
                  <li key={e.id} className="flex gap-3">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${eventTone(e.event_type)}`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900 dark:text-gray-100">{e.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {e.event_date}
                        {e.created_by && ` · ${e.created_by.name}`}
                      </p>
                      {e.description && (
                        <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
                          {e.description}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {employee.warnings.length > 0 && (
            <Section title="Warnings">
              <ul className="space-y-2">
                {employee.warnings.map((w) => (
                  <li key={w.id} className="text-sm">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {w.warning_type.replace('_', ' ')}
                    </span>
                    <span className="ml-2 text-xs uppercase text-gray-500">{w.severity}</span>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {w.issued_on} — {w.reason}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Documents">
            {employee.documents.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <MdOutlineHistory /> No documents on file.
              </p>
            ) : (
              <ul className="space-y-2">
                {employee.documents.map((d) => (
                  <li key={d.id} className="text-sm">
                    <a
                      href={d.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {d.doc_type}
                    </a>
                    {d.expires_on && (
                      <span className="ml-2 text-xs text-gray-500">expires {d.expires_on}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {showAssignment && current && (
        <ChangeAssignmentModal
          employeeId={employeeId}
          current={current}
          designations={designations}
          onClose={() => setShowAssignment(false)}
        />
      )}
      {showExit && (
        <RecordExitModal
          employeeId={employeeId}
          employeeName={employee.full_name}
          dateOfJoining={employee.date_of_joining}
          onClose={() => setShowExit(false)}
        />
      )}
    </div>
  );
};

export default EmployeeDetail;
