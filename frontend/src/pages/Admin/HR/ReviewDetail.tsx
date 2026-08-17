import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  MdArrowBack,
  MdCheckCircle,
  MdOutlineSchool,
  MdWarningAmber,
} from 'react-icons/md';
import {
  hrService,
  ReviewQuestion,
  ReviewTemplateSchema,
} from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import Loader from '../../../components/Loader';
import SearchableSelect from '../../../components/SearchableSelect';
import { eventTone } from './hrShared';

const OUTCOMES = [
  { value: 'no_promotion', label: 'No promotion — continue in role' },
  { value: 'increment_only', label: 'Increment only (no title change)' },
  { value: 'promoted', label: 'Promoted' },
  { value: 'pip', label: 'Performance improvement plan' },
  { value: 'terminate', label: 'Terminate' },
];

const CYCLE_LABELS: Record<string, string> = {
  probation_3m: 'Probation review (3 months)',
  quarterly: 'Quarterly review',
  ad_hoc: 'Ad-hoc review',
};

/** Timeline events worth showing beside a review form. */
const HISTORY_EVENTS = [
  'hired',
  'confirmed',
  'promoted',
  'demoted',
  'review_completed',
  'warning_issued',
  'training_completed',
  'training_expired',
  'salary_changed',
  'transferred',
];

const field =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
const labelClass = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
      {title}
    </h2>
    {children}
  </section>
);

/**
 * The review form.
 *
 * Three things sit on one screen on purpose: the questions, the employee's
 * history, and whether they have the training a promotion needs. The client's
 * complaint about the old process was that the history lived somewhere else, so
 * a reviewer decided from memory.
 *
 * Training gaps WARN and never block — decision #16.
 */
const ReviewDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const cycleId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canApprove = useHasPermission('reviews:approve');

  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [notes, setNotes] = useState({
    strengths: '',
    improvements: '',
    reviewer_comments: '',
  });
  const [decision, setDecision] = useState({
    outcome: '',
    promoted_to_designation_id: '' as number | '',
    new_basic_amount: '' as number | '',
    effective_from: '',
  });
  const [hydrated, setHydrated] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['hr-review', cycleId],
    queryFn: () => hrService.openReview(cycleId),
    enabled: Number.isFinite(cycleId),
  });

  const { data: designations = [] } = useQuery({
    queryKey: ['hr-designations'],
    queryFn: () => hrService.listDesignations(),
  });

  // Seed local state once, then leave it alone — refetches must not overwrite
  // what the reviewer is halfway through typing.
  useEffect(() => {
    if (!data || hydrated) return;
    setAnswers(data.review.answers ?? {});
    setNotes({
      strengths: data.review.strengths ?? '',
      improvements: data.review.improvements ?? '',
      reviewer_comments: data.review.reviewer_comments ?? '',
    });
    setDecision({
      outcome: data.review.outcome ?? '',
      promoted_to_designation_id: data.review.promoted_to_designation_id ?? '',
      new_basic_amount: data.review.new_basic_amount ?? '',
      effective_from: data.review.effective_from ?? '',
    });
    setHydrated(true);
  }, [data, hydrated]);

  const readOnly =
    data != null && ['completed', 'skipped'].includes(data.cycle.status);
  const awaitingApproval = data?.review.status === 'submitted';

  const template: ReviewTemplateSchema = data?.template ?? {};
  const questions: ReviewQuestion[] = useMemo(
    () => (template.sections ?? []).flatMap((s) => s.questions ?? []),
    [template],
  );

  // Scored the same way the server does, so the number on screen while typing
  // matches the one that gets saved. Unanswered ratings are excluded rather
  // than counted as zero — a half-filled form should read as incomplete.
  const score = useMemo(() => {
    const ratings = questions.filter((q) => q.type === 'rating');
    let total = 0;
    let max = 0;
    let answered = 0;
    for (const q of ratings) {
      const value = Number(answers[q.key]);
      if (!Number.isFinite(value)) continue;
      total += value * (q.weight ?? 1);
      max += (q.max ?? 5) * (q.weight ?? 1);
      answered += 1;
    }
    return {
      total: Math.round(total * 100) / 100,
      max: Math.round(max * 100) / 100,
      percent: max > 0 ? Math.round((total / max) * 1000) / 10 : null,
      answered,
      ratingCount: ratings.length,
    };
  }, [questions, answers]);

  const promotionTarget =
    decision.outcome === 'promoted' && decision.promoted_to_designation_id !== ''
      ? Number(decision.promoted_to_designation_id)
      : null;

  const { data: readiness } = useQuery({
    queryKey: ['hr-training-readiness', data?.employee.id, promotionTarget],
    queryFn: () =>
      hrService.trainingReadiness(data!.employee.id, promotionTarget as number),
    enabled: data != null && promotionTarget != null,
  });

  const currentLevel = data?.employee.current_assignment?.designation?.level ?? 0;
  // A "promotion" to the same or a lower grade is a demotion or a transfer, and
  // both have their own flows. Offering them here invites a mis-recorded move.
  const promotionOptions = designations
    .filter((d) => d.level > currentLevel)
    .map((d) => ({ value: String(d.id), label: `${d.name} (level ${d.level})` }));

  const mutationError = (fallback: string) => (err: unknown) => {
    const message =
      (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
        ?.message ?? fallback;
    toast.error(Array.isArray(message) ? message[0] : message);
  };

  const saveDraft = useMutation({
    mutationFn: () => hrService.saveReviewDraft(cycleId, { answers, ...notes }),
    onSuccess: (result) => {
      toast.success(
        result.normalizedPercent != null
          ? `Draft saved — ${result.normalizedPercent}%`
          : 'Draft saved',
      );
      queryClient.invalidateQueries({ queryKey: ['hr-review-cycles'] });
    },
    onError: mutationError('Could not save the draft'),
  });

  const submit = useMutation({
    mutationFn: async () => {
      // Answers are saved first so a submit can never record a decision against
      // a form the server has not seen.
      await hrService.saveReviewDraft(cycleId, { answers, ...notes });
      return hrService.submitReview(cycleId, {
        outcome: decision.outcome,
        promoted_to_designation_id:
          decision.outcome === 'promoted' && decision.promoted_to_designation_id !== ''
            ? Number(decision.promoted_to_designation_id)
            : undefined,
        new_basic_amount:
          decision.new_basic_amount === ''
            ? undefined
            : Number(decision.new_basic_amount),
        effective_from: decision.effective_from || undefined,
        reviewer_comments: notes.reviewer_comments || undefined,
      });
    },
    onSuccess: (result) => {
      toast.success('Submitted for approval');
      if (result.training_gaps?.length) {
        toast(
          `${result.training_gaps.length} required training(s) are incomplete — recorded on the review as a warning.`,
          { icon: '⚠️', duration: 6000 },
        );
      }
      queryClient.invalidateQueries({ queryKey: ['hr-review', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['hr-review-cycles'] });
    },
    onError: mutationError('Could not submit the review'),
  });

  const approve = useMutation({
    mutationFn: () => hrService.approveReview(cycleId),
    onSuccess: (result) => {
      toast.success(
        result.applied?.length
          ? `Approved — ${result.applied.join(', ')}`
          : 'Approved',
      );
      queryClient.invalidateQueries({ queryKey: ['hr-review', cycleId] });
      queryClient.invalidateQueries({ queryKey: ['hr-review-cycles'] });
      queryClient.invalidateQueries({ queryKey: ['hr-employee'] });
    },
    onError: mutationError('Could not approve the review'),
  });

  const skip = useMutation({
    mutationFn: (reason: string) => hrService.skipReviewCycle(cycleId, reason),
    onSuccess: () => {
      toast.success('Cycle skipped — the next one is unchanged');
      queryClient.invalidateQueries({ queryKey: ['hr-review-cycles'] });
      navigate('/admin/hr/reviews');
    },
    onError: mutationError('Could not skip the cycle'),
  });

  const onSkip = () => {
    const reason = window.prompt(
      'Why is this cycle being skipped? (recorded on the employee timeline)',
    );
    if (!reason || reason.trim().length < 3) return;
    skip.mutate(reason.trim());
  };

  const renderQuestion = (q: ReviewQuestion) => {
    const value = answers[q.key];
    const set = (v: unknown) => setAnswers((a) => ({ ...a, [q.key]: v }));

    if (q.type === 'rating') {
      const max = q.max ?? 5;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              disabled={readOnly}
              onClick={() => set(n)}
              className={`h-9 w-9 rounded-md border text-sm font-medium ${
                Number(value) === n
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800'
              } disabled:opacity-60`}
            >
              {n}
            </button>
          ))}
          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
            out of {max}
            {q.weight != null && q.weight !== 1 && ` · weight ×${q.weight}`}
          </span>
        </div>
      );
    }

    if (q.type === 'boolean') {
      return (
        <div className="flex gap-2">
          {[
            { v: true, label: 'Yes' },
            { v: false, label: 'No' },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              disabled={readOnly}
              onClick={() => set(opt.v)}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                value === opt.v
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800'
              } disabled:opacity-60`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      );
    }

    return (
      <textarea
        className={field}
        rows={2}
        disabled={readOnly}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => set(e.target.value)}
      />
    );
  };

  if (isLoading) return <Loader />;
  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600 dark:text-red-400">
          This review could not be opened. It may belong to another branch.
        </p>
        <button
          type="button"
          onClick={() => navigate('/admin/hr/reviews')}
          className="mt-3 text-sm text-blue-600 hover:underline"
        >
          Back to reviews
        </button>
      </div>
    );
  }

  const history = data.employee.timeline.filter((e) =>
    HISTORY_EVENTS.includes(e.event_type),
  );
  const gaps = data.review.training_gaps ?? [];

  return (
    <div className="p-4 md:p-6">
      <button
        type="button"
        onClick={() => navigate('/admin/hr/reviews')}
        className="mb-3 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <MdArrowBack /> Back to reviews
      </button>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            {data.employee.full_name}
            <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
              {data.employee.employee_code}
            </span>
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {CYCLE_LABELS[data.cycle.cycle_type] ?? data.cycle.cycle_type} ·{' '}
            {data.cycle.period_from} → {data.cycle.period_to} · due {data.cycle.due_date}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span
              className={
                data.cycle.is_scheduled
                  ? 'rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300'
                  : 'rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
              }
            >
              {data.cycle.is_scheduled ? 'Scheduled cycle' : 'Ad-hoc review'}
            </span>
            {!data.cycle.is_scheduled && (
              <span className="text-gray-500 dark:text-gray-400">
                Does not affect the scheduled cadence
              </span>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 px-4 py-3 text-right dark:border-slate-700">
          <div className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {score.percent != null ? `${score.percent}%` : '—'}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {score.total} / {score.max} · {score.answered} of {score.ratingCount} rated
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* ---------------------------------------------------------- form */}
        <div className="space-y-5 lg:col-span-2">
          {(template.sections ?? []).length === 0 ? (
            <Panel title="Form">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No review template is configured for this cycle type, so there are no
                questions to answer. The outcome below can still be recorded.
              </p>
            </Panel>
          ) : (
            (template.sections ?? []).map((section) => (
              <Panel key={section.title} title={section.title}>
                <div className="space-y-4">
                  {(section.questions ?? []).map((q) => (
                    <div key={q.key}>
                      <label className={labelClass}>{q.label}</label>
                      {renderQuestion(q)}
                    </div>
                  ))}
                </div>
              </Panel>
            ))
          )}

          <Panel title="Reviewer notes">
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Strengths</label>
                <textarea
                  className={field}
                  rows={2}
                  disabled={readOnly}
                  value={notes.strengths}
                  onChange={(e) =>
                    setNotes((n) => ({ ...n, strengths: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Areas to improve</label>
                <textarea
                  className={field}
                  rows={2}
                  disabled={readOnly}
                  value={notes.improvements}
                  onChange={(e) =>
                    setNotes((n) => ({ ...n, improvements: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Comments</label>
                <textarea
                  className={field}
                  rows={2}
                  disabled={readOnly}
                  value={notes.reviewer_comments}
                  onChange={(e) =>
                    setNotes((n) => ({ ...n, reviewer_comments: e.target.value }))
                  }
                />
              </div>
            </div>
          </Panel>

          <Panel title="Outcome">
            {readOnly ? (
              <p className="text-sm text-gray-700 dark:text-gray-300">
                Recorded outcome:{' '}
                <span className="font-medium">
                  {OUTCOMES.find((o) => o.value === data.review.outcome)?.label ??
                    data.review.outcome ??
                    '—'}
                </span>
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelClass}>Decision *</label>
                  <SearchableSelect
                    value={decision.outcome}
                    onChange={(v) => setDecision((d) => ({ ...d, outcome: v }))}
                    options={OUTCOMES}
                    placeholder="Select an outcome"
                    disabled={awaitingApproval}
                  />
                </div>

                {decision.outcome === 'promoted' && (
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Promote to *</label>
                    <SearchableSelect
                      value={
                        decision.promoted_to_designation_id === ''
                          ? ''
                          : String(decision.promoted_to_designation_id)
                      }
                      onChange={(v) =>
                        setDecision((d) => ({
                          ...d,
                          promoted_to_designation_id: v === '' ? '' : Number(v),
                        }))
                      }
                      options={promotionOptions}
                      placeholder="Select a designation"
                      searchPlaceholder="Search designations…"
                      disabled={awaitingApproval}
                    />
                    {promotionOptions.length === 0 && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        There is no designation above{' '}
                        {data.employee.current_assignment?.designation?.name ??
                          'the current role'}
                        . Record an increment instead.
                      </p>
                    )}
                  </div>
                )}

                {['promoted', 'increment_only'].includes(decision.outcome) && (
                  <>
                    <div>
                      <label className={labelClass}>New monthly basic</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className={field}
                        disabled={awaitingApproval}
                        value={decision.new_basic_amount}
                        onChange={(e) =>
                          setDecision((d) => ({
                            ...d,
                            new_basic_amount:
                              e.target.value === '' ? '' : Number(e.target.value),
                          }))
                        }
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Optional — a title change without a raise is allowed.
                      </p>
                    </div>
                    <div>
                      <label className={labelClass}>Effective from</label>
                      <input
                        type="date"
                        className={field}
                        disabled={awaitingApproval}
                        value={decision.effective_from}
                        onChange={(e) =>
                          setDecision((d) => ({ ...d, effective_from: e.target.value }))
                        }
                      />
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Defaults to the approval date.
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {!readOnly && (
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                {data.cycle.is_scheduled && canApprove && !awaitingApproval && (
                  <button
                    type="button"
                    onClick={onSkip}
                    disabled={skip.isPending}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
                  >
                    Skip this cycle
                  </button>
                )}
                {!awaitingApproval && (
                  <>
                    <button
                      type="button"
                      onClick={() => saveDraft.mutate()}
                      disabled={saveDraft.isPending}
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
                    >
                      {saveDraft.isPending ? 'Saving…' : 'Save draft'}
                    </button>
                    <button
                      type="button"
                      onClick={() => submit.mutate()}
                      disabled={
                        submit.isPending ||
                        decision.outcome === '' ||
                        (decision.outcome === 'promoted' &&
                          decision.promoted_to_designation_id === '')
                      }
                      className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                    >
                      {submit.isPending ? 'Submitting…' : 'Submit for approval'}
                    </button>
                  </>
                )}
                {awaitingApproval && canApprove && (
                  <button
                    type="button"
                    onClick={() => approve.mutate()}
                    disabled={approve.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
                  >
                    <MdCheckCircle />
                    {approve.isPending ? 'Approving…' : 'Approve & apply'}
                  </button>
                )}
                {awaitingApproval && !canApprove && (
                  <p className="self-center text-sm text-gray-500 dark:text-gray-400">
                    Submitted — waiting on someone with approval rights.
                  </p>
                )}
              </div>
            )}
          </Panel>
        </div>

        {/* ------------------------------------------------------- side rail */}
        <div className="space-y-5">
          <Panel title="Training readiness">
            {promotionTarget == null ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Pick a promotion target to check required training.
              </p>
            ) : readiness == null ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Checking…</p>
            ) : readiness.ready ? (
              <p className="flex items-start gap-2 text-sm text-green-700 dark:text-green-400">
                <MdCheckCircle className="mt-0.5 shrink-0" />
                All required training for this designation is complete.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                  <MdWarningAmber className="mt-0.5 shrink-0" />
                  Missing training — this is a warning, not a block. The promotion can
                  still be recorded.
                </p>
                <ul className="space-y-1 text-sm text-gray-700 dark:text-gray-300">
                  {readiness.missing.map((m) => (
                    <li key={m.programId} className="rounded bg-amber-50 px-2 py-1 dark:bg-amber-900/20">
                      {m.programName}{' '}
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        — {m.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {gaps.length > 0 && (
              <p className="mt-3 rounded bg-gray-50 p-2 text-xs text-gray-600 dark:bg-slate-800 dark:text-gray-400">
                {gaps.length} gap(s) were snapshotted when this review was submitted.
              </p>
            )}
          </Panel>

          <Panel title="Training record">
            {data.trainings.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                No training assigned yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.trainings.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-2 text-sm">
                    <div>
                      <div className="flex items-center gap-1.5 text-gray-800 dark:text-gray-200">
                        <MdOutlineSchool className="text-gray-400" />
                        {t.program.name ?? `Program #${t.program.id}`}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {t.status === 'completed' && t.completed_on
                          ? `Completed ${t.completed_on}`
                          : t.status.replace('_', ' ')}
                        {t.score != null && ` · ${t.score}`}
                        {t.expires_on && ` · expires ${t.expires_on}`}
                      </div>
                    </div>
                    {t.expiring_soon && (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                        Expiring
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="History">
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
              Joined {data.employee.date_of_joining} ·{' '}
              {data.employee.current_assignment?.designation?.name ?? 'No designation'} at{' '}
              {data.employee.current_assignment?.branch.name ?? '—'}
            </p>
            {history.length === 0 ? (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Nothing recorded yet.
              </p>
            ) : (
              <ol className="space-y-3">
                {history.map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${eventTone(e.event_type)}`}
                    />
                    <div>
                      <div className="text-sm text-gray-800 dark:text-gray-200">
                        {e.title}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {e.event_date}
                        {e.created_by?.name && ` · ${e.created_by.name}`}
                      </div>
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
            <button
              type="button"
              onClick={() => navigate(`/admin/hr/employees/${data.employee.id}`)}
              className="mt-3 text-sm text-blue-600 hover:underline"
            >
              Open full employee record
            </button>
          </Panel>
        </div>
      </div>
    </div>
  );
};

export default ReviewDetail;
