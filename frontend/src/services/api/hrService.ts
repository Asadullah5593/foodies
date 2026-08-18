import apiClient from '../../utils/apiClient';

/**
 * Employee HRM (docs/HRM.md). Separate from riderService/riderSupervisorService:
 * those cover dispatch and rider pay, this covers people.
 *
 * Everything is scoped server-side to the caller's branches and brands, so no
 * screen needs to filter for safety — only for the user's convenience.
 */

export interface Designation {
  id: number;
  name: string;
  slug: string;
  level: number;
  department: 'kitchen' | 'front_of_house' | 'delivery' | 'management' | 'support';
  default_role_id: number | null;
  default_role_name: string | null;
  is_active: boolean;
  employee_count: number;
}

export interface EmployeeListRow {
  id: number;
  employee_code: string;
  full_name: string;
  phone: string | null;
  photo_url: string | null;
  status: string;
  employment_type: string;
  date_of_joining: string;
  has_login: boolean;
  branch: { id: number; name: string | null } | null;
  brand: { id: number | null; name: string | null } | null;
  designation: { id: number; name: string; department: string } | null;
}

export interface EmployeeListResponse {
  data: EmployeeListRow[];
  meta: { page: number; limit: number; total: number; pages: number };
}

export interface EmployeeAssignmentRow {
  id: number;
  branch: { id: number; name: string | null };
  brand: { id: number | null; name: string | null } | null;
  designation: { id: number; name: string; level: number; department: string } | null;
  employment_type: string;
  effective_from: string;
  effective_to: string | null;
  is_current: boolean;
  change_reason: string;
  note: string | null;
  created_by: { id: number; name: string } | null;
}

export interface EmployeeTimelineEntry {
  id: number;
  event_type: string;
  event_date: string;
  title: string;
  description: string | null;
  ref_table: string | null;
  ref_id: number | null;
  payload: Record<string, unknown>;
  created_by: { id: number; name: string } | null;
  created_at: string;
}

export interface EmployeeDocumentRow {
  id: number;
  doc_type: string;
  file_url: string;
  document_number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  note: string | null;
}

export interface EmployeeWarningRow {
  id: number;
  warning_type: string;
  severity: string;
  issued_on: string;
  reason: string;
  document_url: string | null;
  issued_by: { id: number; name: string } | null;
}

/**
 * The 360 payload. Bank fields are ABSENT (not null) unless the caller holds
 * `salary:view` — the server omits the keys entirely, so `'bank_name' in emp`
 * is the honest test rather than a truthiness check on an empty string.
 */
export interface EmployeeDetail {
  id: number;
  employee_code: string;
  full_name: string;
  father_name: string | null;
  cnic: string | null;
  date_of_birth: string | null;
  gender: string | null;
  phone: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  photo_url: string | null;
  user_id: number | null;
  has_login: boolean;
  employment_type: string;
  date_of_joining: string;
  probation_end_date: string | null;
  confirmation_date: string | null;
  status: string;
  date_of_leaving: string | null;
  leaving_reason: string | null;
  rehire_eligible: boolean | null;
  has_pin: boolean;
  /** Readable and reprintable; the PIN is hashed and is not. */
  qr_token: string | null;
  qr_token_issued_at: string | null;
  bank_name?: string | null;
  account_title?: string | null;
  account_number_iban?: string | null;
  payment_method?: string;
  current_assignment: EmployeeAssignmentRow | null;
  assignments: EmployeeAssignmentRow[];
  timeline: EmployeeTimelineEntry[];
  documents: EmployeeDocumentRow[];
  warnings: EmployeeWarningRow[];
}

export interface EmployeeExitDetail {
  id: number;
  employee_id: number;
  exit_type: string;
  initiated_on: string;
  last_working_date: string;
  notice_period_days: number;
  reason: string | null;
  exit_interview_notes: string | null;
  rehire_eligible: boolean;
  clearance_status: 'pending' | 'in_progress' | 'cleared' | 'withheld';
  settlement_payroll_line_id: number | null;
  settled_at: string | null;
  initiated_by: { id: number; name: string } | null;
  clearance_items: Array<{
    id: number;
    item_type: string;
    description: string;
    responsible_role: string | null;
    status: 'pending' | 'cleared' | 'withheld' | 'not_applicable';
    note: string | null;
    cleared_at: string | null;
  }>;
}

export interface EmployeeListParams {
  search?: string;
  branch_id?: number;
  brand_id?: number;
  designation_id?: number;
  status?: string;
  include_inactive?: boolean;
  page?: number;
  limit?: number;
}

export interface CreateEmployeePayload {
  employee_code?: string;
  full_name: string;
  father_name?: string;
  cnic?: string;
  date_of_birth?: string;
  gender?: string;
  phone?: string;
  address?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  user_id?: number;
  branch_id: number;
  brand_id?: number;
  designation_id: number;
  employment_type?: string;
  date_of_joining: string;
  probation_end_date?: string;
}

export interface ChangeAssignmentPayload {
  change_reason:
    | 'promotion'
    | 'demotion'
    | 'transfer_branch'
    | 'transfer_brand'
    | 'designation_change'
    | 'confirmation';
  effective_from: string;
  branch_id?: number;
  brand_id?: number | null;
  designation_id?: number;
  employment_type?: string;
  note?: string;
}

export interface RecordExitPayload {
  exit_type: 'resignation' | 'termination' | 'end_of_contract' | 'abandonment';
  initiated_on: string;
  last_working_date: string;
  notice_period_days?: number;
  reason?: string;
  exit_interview_notes?: string;
  rehire_eligible?: boolean;
}

export type PayrollStatus =
  | 'draft'
  | 'computed'
  | 'pending_approval'
  | 'approved'
  | 'paid'
  | 'reversed';

export interface PayrollRunRow {
  id: number;
  periodFrom: string;
  periodTo: string;
  status: PayrollStatus;
  computedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  reversalReason: string | null;
  branch: { id: number; name: string } | null;
  approver: { id: number; name: string } | null;
}

export interface PayrollRunLine {
  id: number;
  employee: { id: number; full_name: string; employee_code: string };
  present_days: number;
  absent_days: number;
  half_days: number;
  paid_leave_days: number;
  unpaid_leave_days: number;
  late_count: number;
  overtime_minutes: number;
  delivered_orders: number;
  gross_earnings: number;
  total_deductions: number;
  net_payable: number;
  payment_status: string;
}

export interface PayrollRunDetail {
  id: number;
  period_from: string;
  period_to: string;
  status: PayrollStatus;
  rule_snapshot: Record<string, unknown>;
  reversal_reason: string | null;
  totals: { gross: number; deductions: number; net: number };
  lines: PayrollRunLine[];
}

export interface PayrollPreflight {
  ready: boolean;
  blockers: string[];
  line_count: number;
  total_net: number;
}

export interface PayslipItem {
  component_key: string;
  component_name: string;
  kind: 'earning' | 'deduction' | 'waiver' | 'adjustment';
  quantity: number;
  rate: number;
  amount: number;
  /** The arithmetic behind the figure. */
  calc_meta: Record<string, unknown>;
}

export interface Payslip {
  id: number;
  run: { id: number; period_from: string; period_to: string; status: PayrollStatus };
  employee: { id: number; full_name: string; employee_code: string };
  attendance: {
    present_days: number;
    half_days: number;
    paid_leave_days: number;
    unpaid_leave_days: number;
    absent_days: number;
    weekly_off_days: number;
    holiday_days: number;
    late_count: number;
    overtime_minutes: number;
  };
  items: PayslipItem[];
  gross_earnings: number;
  total_deductions: number;
  net_payable: number;
  currency: string;
}

export interface SalaryStructureRow {
  id: number;
  effective_from: string;
  effective_to: string | null;
  is_current: boolean;
  pay_type: string;
  basic_amount: number;
  daily_rate_basis: string;
  per_delivered_order_amount: number;
  change_reason: string | null;
  set_by: { id: number; name: string } | null;
  components: Array<{
    component_key: string;
    name: string;
    kind: string;
    calc_type: string;
    amount: number;
  }>;
}

export interface AdvanceRow {
  id: number;
  /** Decimal columns arrive as strings from TypeORM — coerce before arithmetic. */
  principalAmount: string | number;
  installmentAmount: string | number;
  installmentsTotal: number;
  installmentsPaid: number;
  outstandingAmount: string | number;
  status: 'active' | 'settled' | 'written_off';
  disbursedOn: string | null;
  note: string | null;
  employee: { id: number; fullName: string; employeeCode: string } | null;
}

export interface StationRow {
  id: number;
  label: string;
  /** Readable so a replacement device can be set up without re-registering. */
  token: string;
  isActive: boolean;
  lastSeenAt: string | null;
  branchId: number;
  branch: { name: string } | null;
}

export interface ReviewCycleRow {
  id: number;
  cycle_type: 'probation_3m' | 'quarterly' | 'ad_hoc';
  /** False for ad-hoc. Completion metrics must count scheduled cycles only. */
  is_scheduled: boolean;
  ad_hoc_reason: string | null;
  sequence_no: number | null;
  period_from: string;
  period_to: string;
  due_date: string;
  overdue: boolean;
  status: string;
  template_id: number | null;
  employee: { id: number; full_name: string; employee_code: string };
  reviewer: { id: number; name: string } | null;
}

export interface ReviewQuestion {
  key: string;
  label: string;
  type: 'rating' | 'text' | 'boolean' | 'select';
  weight?: number;
  max?: number;
}

export interface ReviewTemplateSchema {
  sections?: Array<{ title: string; questions: ReviewQuestion[] }>;
}

export interface ReviewDetail {
  cycle: {
    id: number;
    cycle_type: string;
    is_scheduled: boolean;
    ad_hoc_reason: string | null;
    period_from: string;
    period_to: string;
    due_date: string;
    status: string;
  };
  review: {
    id: number;
    answers: Record<string, unknown>;
    total_score: number;
    max_score: number;
    normalized_percent: number | null;
    strengths: string | null;
    improvements: string | null;
    reviewer_comments: string | null;
    outcome: string | null;
    promoted_to_designation_id: number | null;
    new_basic_amount: number | null;
    effective_from: string | null;
    training_gaps: Array<{ programName?: string; reason?: string }>;
    status: string;
  };
  template: ReviewTemplateSchema;
  employee: EmployeeDetail;
  trainings: EmployeeTrainingRow[];
}

export interface EmployeeTrainingRow {
  id: number;
  program: { id: number; name?: string; category?: string | null; level?: number };
  status: string;
  assigned_on: string | null;
  completed_on: string | null;
  expires_on: string | null;
  expiring_soon: boolean;
  score: number | null;
  certificate_url: string | null;
}

export interface TrainingProgramRow {
  id: number;
  name: string;
  code: string;
  category: string | null;
  level: number;
  durationHours: number;
  validityMonths: number | null;
  isMandatory: boolean;
  isActive: boolean;
}

export interface CapturePolicyRow {
  id: number;
  branchId: number | null;
  primaryMethod: 'pin' | 'qr' | 'photo' | 'attestation';
  requirePhoto: boolean;
  allowManagerAttestation: boolean;
  duplicateWindowSeconds: number;
  photoRetentionDays: number;
  isActive: boolean;
}

export interface OvertimePolicyRow {
  id: number;
  branchId: number | null;
  designationId: number | null;
  isEnabled: boolean;
  minMinutesToQualify: number;
  roundingMinutes: number;
  rateType: 'multiplier_of_hourly' | 'flat_per_hour';
  rateValue: string | number;
  weeklyOffMultiplier: string | number;
  holidayMultiplier: string | number;
  dailyCapMinutes: number | null;
  monthlyCapMinutes: number | null;
  requiresApproval: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
}

export interface OffsPolicyRow {
  id: number;
  branchId: number | null;
  designationId: number | null;
  offsPerMonth: number;
  offsArePaid: boolean;
  carryForward: boolean;
  encashUnused: boolean;
  offSelection: 'floating' | 'fixed_weekday';
  beyondQuotaTreatment: 'unpaid' | 'refuse';
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
}

export interface DeductionRuleRow {
  id: number;
  branchId: number | null;
  designationId: number | null;
  trigger:
    | 'late'
    | 'absent'
    | 'half_day'
    | 'early_leave'
    | 'missed_punch'
    | 'unapproved_leave';
  condition: Record<string, unknown>;
  effectType: 'deduct_days' | 'deduct_amount' | 'deduct_percent_of_daily';
  effectValue: string | number;
  priority: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
}

export interface ApprovalRuleRow {
  id: number;
  branchId: number | null;
  subject:
    | 'attendance_waiver'
    | 'leave_request'
    | 'overtime'
    | 'payroll_run'
    | 'salary_change'
    | 'promotion'
    | 'payroll_adjustment';
  condition: Record<string, unknown>;
  requiredPermission: string;
  escalateToPermission: string | null;
  priority: number;
  isActive: boolean;
}

export interface ScheduleTemplateRow {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  branchId: number | null;
  graceMinutes: number;
  isDefault: boolean;
}

export interface ScheduleTemplateFull extends ScheduleTemplateRow {
  designationId: number | null;
  breakMinutes: number;
  halfDayAfterLateMinutes: number | null;
  minMinutesFullDay: number;
  minMinutesHalfDay: number;
  overtimeAfterMinutes: number;
  attributionLeadHours: number;
  attributionTrailHours: number;
  isActive: boolean;
}

export interface RosterCell {
  id: number;
  employee_id: number;
  work_date: string;
  template_id: number | null;
  is_weekly_off: boolean;
  is_holiday: boolean;
  is_published: boolean;
}

export interface RosterGrid {
  range: { from: string; to: string };
  employees: Array<{
    id: number;
    full_name: string;
    employee_code: string;
    status: string;
    designation_name: string | null;
    brand_name: string | null;
    /** What an empty cell falls back to. */
    default_template_id: number | null;
  }>;
  cells: RosterCell[];
}

export interface LabourCostRow {
  branch_id: number | null;
  branch_name: string | null;
  brand_id: number | null;
  brand_name: string | null;
  labour_cost: number;
  net_sales: number;
  revenue: number;
  /** Null when there were no sales — that is not 0%. */
  labour_percent: number | null;
  headcount: number;
}

export interface LabourCostReport {
  period: { from: string; to: string };
  rows: LabourCostRow[];
  totals: {
    labour_cost: number;
    net_sales: number;
    revenue: number;
    labour_percent: number | null;
    headcount: number;
  };
  /** Runs straddling the range, excluded rather than pro-rated. */
  excluded_partial_runs: Array<{
    id: number;
    period_from: string;
    period_to: string;
    branch_name: string | null;
  }>;
}

export interface HrAlertRow {
  kind: 'document_expiring' | 'training_expiring' | 'probation_ending' | 'review_overdue';
  dedupeKey: string;
  branchId: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  date: string;
  label: string;
  detail: string | null;
  link: string;
}

export interface HrAlerts {
  documents: HrAlertRow[];
  trainings: HrAlertRow[];
  probations: HrAlertRow[];
  reviews: HrAlertRow[];
}

export interface TrainingRequirementRow {
  id: number;
  designationId: number;
  programId: number;
  requiredFor: 'promotion_into' | 'holding_role';
  minScore: number | null;
  program: { name: string } | null;
  designation: { name: string } | null;
}

export type DayPart = 'full' | 'first_half' | 'second_half';

export interface LeaveTypeRow {
  id: number;
  name: string;
  code: string;
  isPaid: boolean;
  /** Decimal column: a string over the wire. */
  quotaPerPeriod: string | number;
  encashUnused: boolean;
  isMonthlyOff: boolean;
  isActive: boolean;
  // Present on the settings endpoint, absent from the leave-request picker.
  carryForward?: boolean;
  maxConsecutiveDays?: number | null;
  requiresDocument?: boolean;
  sortOrder?: number;
}

export interface LeaveRequestRow {
  id: number;
  fromDate: string;
  toDate: string;
  firstDayPart: DayPart;
  lastDayPart: DayPart;
  totalDays: number;
  paidDays: number;
  unpaidDays: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decisionNote: string | null;
  employee: { id: number; fullName: string; employeeCode: string } | null;
  leaveType: { id: number; name: string; isPaid: boolean } | null;
  approver: { id: number; name: string } | null;
}

export interface LeaveDecision {
  id: number;
  status: string;
  paid_days?: number;
  unpaid_days?: number;
  days_written?: number;
  /** Days inside an approved payroll period, deliberately not rewritten. */
  locked_days?: number;
}

export interface LeaveBalanceRow {
  leave_type_id: number;
  name: string;
  code: string;
  is_paid: boolean;
  is_monthly_off: boolean;
  encash_unused: boolean;
  entitled: number;
  carried_forward: number;
  adjusted: number;
  used: number;
  available: number;
}

export interface PublicHolidayRow {
  id: number;
  holidayDate: string;
  name: string;
  isPaid: boolean;
  branchId: number | null;
}

export type PunchType = 'in' | 'out' | 'break_start' | 'break_end';

export interface PunchResult {
  duplicate: boolean;
  punch_id: number;
  employee: {
    id: number;
    full_name: string;
    employee_code?: string;
    photo_url?: string | null;
  };
  punch_type: PunchType;
  punched_at: string;
  work_date?: string | null;
  /** True when no shift claimed the punch — recorded, but needs a manager. */
  orphan?: boolean;
}

export interface RegisterRow {
  id: number;
  work_date: string;
  employee: { id: number; full_name: string; employee_code: string };
  branch_name: string | null;
  status: string;
  first_in_at: string | null;
  last_out_at: string | null;
  worked_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_pending: number;
  overtime_approved: number;
  flags: Record<string, unknown>;
  is_locked: boolean;
}

export interface ExceptionsReport {
  flagged_days: RegisterRow[];
  bursts: Array<{
    pos_user_id: number;
    branch_id: number;
    minute: string;
    punch_count: number;
  }>;
}

export const hrService = {
  listEmployees: async (params: EmployeeListParams = {}): Promise<EmployeeListResponse> => {
    const { data } = await apiClient.get('/admin/hr/employees', { params });
    return data;
  },

  getEmployee: async (id: number): Promise<EmployeeDetail> => {
    const { data } = await apiClient.get(`/admin/hr/employees/${id}`);
    return data;
  },

  createEmployee: async (payload: CreateEmployeePayload): Promise<{ id: number; employee_code: string }> => {
    const { data } = await apiClient.post('/admin/hr/employees', payload);
    return data;
  },

  updateEmployee: async (id: number, payload: Record<string, unknown>): Promise<{ id: number; updated: boolean }> => {
    const { data } = await apiClient.put(`/admin/hr/employees/${id}`, payload);
    return data;
  },

  changeAssignment: async (id: number, payload: ChangeAssignmentPayload): Promise<{ id: number }> => {
    const { data } = await apiClient.post(`/admin/hr/employees/${id}/assignment`, payload);
    return data;
  },

  getExit: async (id: number): Promise<EmployeeExitDetail | null> => {
    const { data } = await apiClient.get(`/admin/hr/employees/${id}/exit`);
    return data;
  },

  recordExit: async (id: number, payload: RecordExitPayload): Promise<{ id: number; status: string }> => {
    const { data } = await apiClient.post(`/admin/hr/employees/${id}/exit`, payload);
    return data;
  },

  updateClearanceItem: async (
    exitId: number,
    itemId: number,
    payload: { status: string; note?: string },
  ): Promise<{ id: number; clearance_status: string }> => {
    const { data } = await apiClient.patch(`/admin/hr/exits/${exitId}/clearance/${itemId}`, payload);
    return data;
  },

  addWarning: async (
    id: number,
    payload: { warning_type: string; severity?: string; issued_on: string; reason: string; document_url?: string },
  ): Promise<{ id: number }> => {
    const { data } = await apiClient.post(`/admin/hr/employees/${id}/warnings`, payload);
    return data;
  },

  // --- attendance ---------------------------------------------------------

  punch: async (payload: {
    branch_id: number;
    punch_type: PunchType;
    employee_code?: string;
    pin?: string;
    qr_token?: string;
    photo_url?: string;
  }): Promise<PunchResult> => {
    const { data } = await apiClient.post('/admin/hr/attendance/punch', payload);
    return data;
  },

  attest: async (payload: {
    branch_id: number;
    employee_id: number;
    punch_type: PunchType;
    note?: string;
  }): Promise<{ punch_id: number; work_date: string | null }> => {
    const { data } = await apiClient.post('/admin/hr/attendance/attest', payload);
    return data;
  },

  getRegister: async (params: {
    branch_id?: number;
    date_from: string;
    date_to: string;
  }): Promise<RegisterRow[]> => {
    const { data } = await apiClient.get('/admin/hr/attendance/register', { params });
    return data;
  },

  getExceptionsReport: async (params: {
    branch_id?: number;
    date_from: string;
    date_to: string;
  }): Promise<ExceptionsReport> => {
    const { data } = await apiClient.get('/admin/hr/attendance/exceptions-report', { params });
    return data;
  },

  getDayPunches: async (
    dayId: number,
  ): Promise<{
    work_date: string;
    worked_minutes: number;
    sessions: Array<{ in_at: string; out_at: string; minutes: number }>;
    open_session: boolean;
    punches: Array<{
      id: number;
      punch_type: string;
      punched_at: string;
      source: string;
      method: string;
      station_id: number | null;
      pos_user: { id: number; name: string } | null;
      photo_url: string | null;
      note: string | null;
    }>;
  }> => {
    const { data } = await apiClient.get(`/admin/hr/attendance/days/${dayId}/punches`);
    return data;
  },

  correctDayTimes: async (
    dayId: number,
    payload: { first_in_at?: string; last_out_at?: string; reason: string },
  ): Promise<{ exception_id: number; worked_minutes: number; status: string }> => {
    const { data } = await apiClient.patch(
      `/admin/hr/attendance/days/${dayId}/times`,
      payload,
    );
    return data;
  },

  createException: async (
    dayId: number,
    payload: {
      kind: 'adjustment' | 'waiver' | 'overtime_approval';
      subject: string;
      reason: string;
      new_value?: Record<string, unknown>;
      minutes_waived?: number;
    },
  ): Promise<{ id: number; status: string }> => {
    const { data } = await apiClient.post(
      `/admin/hr/attendance/days/${dayId}/exceptions`,
      payload,
    );
    return data;
  },

  decideException: async (
    id: number,
    decision: 'approved' | 'rejected',
  ): Promise<{ id: number; status: string }> => {
    const { data } = await apiClient.patch(`/admin/hr/attendance/exceptions/${id}`, {
      decision,
    });
    return data;
  },

  setPin: async (employeeId: number, pin: string): Promise<{ updated: boolean }> => {
    const { data } = await apiClient.put(`/admin/hr/employees/${employeeId}/pin`, { pin });
    return data;
  },

  // --- leaves -------------------------------------------------------------

  listLeaves: async (params: {
    employee_id?: number;
    status?: string;
    date_from?: string;
    date_to?: string;
  } = {}): Promise<LeaveRequestRow[]> => {
    const { data } = await apiClient.get('/admin/hr/leaves', { params });
    return data;
  },

  createLeave: async (payload: {
    employee_id: number;
    leave_type_id: number;
    from_date: string;
    to_date: string;
    first_day_part?: DayPart;
    last_day_part?: DayPart;
    reason?: string;
  }): Promise<{ id: number; total_days: number }> => {
    const { data } = await apiClient.post('/admin/hr/leaves', payload);
    return data;
  },

  decideLeave: async (
    id: number,
    decision: 'approved' | 'rejected' | 'cancelled',
    note?: string,
  ): Promise<LeaveDecision> => {
    const { data } = await apiClient.patch(`/admin/hr/leaves/${id}`, { decision, note });
    return data;
  },

  getLeaveBalances: async (
    employeeId: number,
    year?: number,
    month?: number,
  ): Promise<LeaveBalanceRow[]> => {
    const { data } = await apiClient.get(`/admin/hr/leaves/balances/${employeeId}`, {
      params: { year, month },
    });
    return data;
  },

  listLeaveTypes: async (): Promise<LeaveTypeRow[]> => {
    const { data } = await apiClient.get('/admin/hr/settings/leave-types');
    return data;
  },

  listPublicHolidays: async (year?: number): Promise<PublicHolidayRow[]> => {
    const { data } = await apiClient.get('/admin/hr/settings/public-holidays', {
      params: { year },
    });
    return data;
  },

  createPublicHoliday: async (payload: {
    holiday_date: string;
    name: string;
    branch_id?: number;
    is_paid?: boolean;
  }): Promise<{ id: number }> => {
    const { data } = await apiClient.post('/admin/hr/settings/public-holidays', payload);
    return data;
  },

  deletePublicHoliday: async (id: number): Promise<{ deleted: boolean }> => {
    const { data } = await apiClient.delete(`/admin/hr/settings/public-holidays/${id}`);
    return data;
  },

  // --- payroll ------------------------------------------------------------

  listPayrollRuns: async (): Promise<PayrollRunRow[]> => {
    const { data } = await apiClient.get('/admin/hr/payroll/runs');
    return data;
  },

  getPayrollRun: async (id: number): Promise<PayrollRunDetail> => {
    const { data } = await apiClient.get(`/admin/hr/payroll/runs/${id}`);
    return data;
  },

  getPayrollPreflight: async (id: number): Promise<PayrollPreflight> => {
    const { data } = await apiClient.get(`/admin/hr/payroll/runs/${id}/preflight`);
    return data;
  },

  createPayrollRun: async (payload: {
    period_from: string;
    period_to: string;
    branch_id?: number;
  }): Promise<{ id: number; status: string }> => {
    const { data } = await apiClient.post('/admin/hr/payroll/runs', payload);
    return data;
  },

  computePayrollRun: async (
    id: number,
    projectFullPeriod = false,
  ): Promise<{
    id: number;
    status: string;
    lines: number;
    skipped: Array<{ employee: string; reason: string }>;
    as_of: string;
    projected_full_period: boolean;
  }> => {
    const { data } = await apiClient.post(
      `/admin/hr/payroll/runs/${id}/compute`,
      {},
      { params: projectFullPeriod ? { project_full_period: 1 } : {} },
    );
    return data;
  },

  approvePayrollRun: async (
    id: number,
    force = false,
  ): Promise<{ id: number; status: string; exits_settled?: number }> => {
    const { data } = await apiClient.post(`/admin/hr/payroll/runs/${id}/approve`, {
      force,
    });
    return data;
  },

  reversePayrollRun: async (
    id: number,
    reason: string,
  ): Promise<{ id: number; status: string }> => {
    const { data } = await apiClient.post(`/admin/hr/payroll/runs/${id}/reverse`, {
      reason,
    });
    return data;
  },

  markPayrollPaid: async (id: number): Promise<{ id: number; status: string }> => {
    const { data } = await apiClient.post(`/admin/hr/payroll/runs/${id}/mark-paid`);
    return data;
  },

  getPayslip: async (lineId: number): Promise<Payslip> => {
    const { data } = await apiClient.get(`/admin/hr/payroll/payslips/${lineId}`);
    return data;
  },

  addPayrollAdjustment: async (
    lineId: number,
    payload: {
      direction: 'waive' | 'add_deduction' | 'add_earning';
      amount: number;
      reason: string;
      target_component_key?: string;
    },
  ): Promise<{ id: number }> => {
    const { data } = await apiClient.post(
      `/admin/hr/payroll/payslips/${lineId}/adjustments`,
      payload,
    );
    return data;
  },

  // --- salary & advances ---------------------------------------------------

  getSalaryHistory: async (employeeId: number): Promise<SalaryStructureRow[]> => {
    const { data } = await apiClient.get(`/admin/hr/employees/${employeeId}/salary`);
    return data;
  },

  setSalary: async (
    employeeId: number,
    payload: {
      effective_from: string;
      basic_amount: number;
      daily_rate_basis?: string;
      per_delivered_order_amount?: number;
      change_reason?: string;
      components?: Array<{
        component_key: string;
        name: string;
        kind: 'earning' | 'deduction';
        calc_type: 'flat' | 'percent_of_basic';
        amount: number;
      }>;
    },
  ): Promise<{ id: number }> => {
    const { data } = await apiClient.post(
      `/admin/hr/employees/${employeeId}/salary`,
      payload,
    );
    return data;
  },

  listAdvances: async (employeeId?: number): Promise<AdvanceRow[]> => {
    const { data } = await apiClient.get('/admin/hr/advances', {
      params: employeeId ? { employee_id: employeeId } : {},
    });
    return data;
  },

  createAdvance: async (payload: {
    employee_id: number;
    principal_amount: number;
    installment_amount: number;
    disbursed_on?: string;
    note?: string;
  }): Promise<{
    id: number;
    outstanding: number;
    installments_total: number;
  }> => {
    const { data } = await apiClient.post('/admin/hr/advances', payload);
    return data;
  },

  writeOffAdvance: async (
    id: number,
    reason: string,
  ): Promise<{ id: number; status: string }> => {
    const { data } = await apiClient.post(`/admin/hr/advances/${id}/write-off`, {
      reason,
    });
    return data;
  },

  // --- attendance devices --------------------------------------------------

  listStations: async (): Promise<StationRow[]> => {
    const { data } = await apiClient.get('/admin/hr/attendance-stations');
    return data;
  },

  createStation: async (payload: {
    branch_id: number;
    label: string;
  }): Promise<{ id: number; token: string }> => {
    const { data } = await apiClient.post('/admin/hr/attendance-stations', payload);
    return data;
  },

  revokeStation: async (id: number): Promise<{ revoked: boolean }> => {
    const { data } = await apiClient.delete(`/admin/hr/attendance-stations/${id}`);
    return data;
  },

  // --- attendance credentials ---------------------------------------------

  issueQrCard: async (
    employeeId: number,
  ): Promise<{ qr_token: string; employee_code: string }> => {
    const { data } = await apiClient.post(
      `/admin/hr/employees/${employeeId}/qr-card`,
    );
    return data;
  },

  revokeQrCard: async (employeeId: number): Promise<{ revoked: boolean }> => {
    const { data } = await apiClient.delete(
      `/admin/hr/employees/${employeeId}/qr-card`,
    );
    return data;
  },

  // --- reviews --------------------------------------------------------------

  listReviewCycles: async (params: {
    status?: string;
    employee_id?: number;
    overdue_only?: boolean;
  } = {}): Promise<ReviewCycleRow[]> => {
    const { data } = await apiClient.get('/admin/hr/reviews/cycles', {
      params: {
        ...params,
        overdue_only: params.overdue_only ? 1 : undefined,
      },
    });
    return data;
  },

  syncReviewCycles: async (): Promise<{ created: number; employees: number }> => {
    const { data } = await apiClient.post('/admin/hr/reviews/sync');
    return data;
  },

  createAdHocReview: async (payload: {
    employee_id: number;
    ad_hoc_reason: string;
    due_date: string;
  }): Promise<{ id: number }> => {
    const { data } = await apiClient.post('/admin/hr/reviews/ad-hoc', payload);
    return data;
  },

  openReview: async (cycleId: number): Promise<ReviewDetail> => {
    const { data } = await apiClient.get(`/admin/hr/reviews/cycles/${cycleId}`);
    return data;
  },

  saveReviewDraft: async (
    cycleId: number,
    payload: {
      answers?: Record<string, unknown>;
      strengths?: string;
      improvements?: string;
      reviewer_comments?: string;
    },
  ): Promise<{ totalScore: number; maxScore: number; normalizedPercent: number | null }> => {
    const { data } = await apiClient.patch(
      `/admin/hr/reviews/cycles/${cycleId}`,
      payload,
    );
    return data;
  },

  submitReview: async (
    cycleId: number,
    payload: {
      outcome: string;
      promoted_to_designation_id?: number;
      new_basic_amount?: number;
      effective_from?: string;
      reviewer_comments?: string;
    },
  ): Promise<{ id: number; status: string; training_gaps: unknown[] }> => {
    const { data } = await apiClient.post(
      `/admin/hr/reviews/cycles/${cycleId}/submit`,
      payload,
    );
    return data;
  },

  approveReview: async (
    cycleId: number,
  ): Promise<{ id: number; status: string; applied: string[] }> => {
    const { data } = await apiClient.post(
      `/admin/hr/reviews/cycles/${cycleId}/approve`,
    );
    return data;
  },

  skipReviewCycle: async (
    cycleId: number,
    reason: string,
  ): Promise<{ id: number; status: string }> => {
    const { data } = await apiClient.post(
      `/admin/hr/reviews/cycles/${cycleId}/skip`,
      { reason },
    );
    return data;
  },

  // --- training -------------------------------------------------------------

  listTrainingPrograms: async (): Promise<TrainingProgramRow[]> => {
    const { data } = await apiClient.get('/admin/hr/training/programs');
    return data;
  },

  createTrainingProgram: async (payload: {
    name: string;
    category?: string;
    level?: number;
    duration_hours?: number;
    validity_months?: number;
    is_mandatory?: boolean;
  }): Promise<{ id: number; code: string }> => {
    const { data } = await apiClient.post('/admin/hr/training/programs', payload);
    return data;
  },

  listEmployeeTrainings: async (employeeId: number): Promise<EmployeeTrainingRow[]> => {
    const { data } = await apiClient.get(`/admin/hr/training/employees/${employeeId}`);
    return data;
  },

  assignTraining: async (
    employeeId: number,
    programId: number,
  ): Promise<{ id: number; restarted: boolean }> => {
    const { data } = await apiClient.post(
      `/admin/hr/training/employees/${employeeId}/assign`,
      { program_id: programId },
    );
    return data;
  },

  recordTraining: async (
    recordId: number,
    payload: {
      status: 'in_progress' | 'completed' | 'failed';
      completed_on?: string;
      score?: number;
      certificate_url?: string;
    },
  ): Promise<{ id: number; status: string; expires_on: string | null }> => {
    const { data } = await apiClient.patch(
      `/admin/hr/training/records/${recordId}`,
      payload,
    );
    return data;
  },

  listExpiringTrainings: async (withinDays = 30) => {
    const { data } = await apiClient.get('/admin/hr/training/expiring', {
      params: { within_days: withinDays },
    });
    return data as Array<{
      id: number;
      expiresOn: string;
      program: { name: string } | null;
      employee: { id: number; fullName: string; employeeCode: string } | null;
    }>;
  },

  // --- settings -------------------------------------------------------------

  settingsList: async <T,>(
    resource: string,
    includeInactive = false,
  ): Promise<T[]> => {
    const { data } = await apiClient.get(`/admin/hr/settings/${resource}`, {
      params: { include_inactive: includeInactive ? 1 : undefined },
    });
    return data;
  },

  settingsSave: async (
    resource: string,
    payload: Record<string, unknown>,
  ): Promise<{ id: number; updated: boolean }> => {
    const { data } = await apiClient.post(
      `/admin/hr/settings/${resource}`,
      payload,
    );
    return data;
  },

  settingsRemove: async (
    resource: string,
    id: number,
  ): Promise<{ deleted?: boolean; deactivated?: boolean }> => {
    const { data } = await apiClient.delete(
      `/admin/hr/settings/${resource}/${id}`,
    );
    return data;
  },

  listScheduleTemplates: async (
    branchId?: number,
  ): Promise<ScheduleTemplateRow[]> => {
    const { data } = await apiClient.get('/admin/hr/roster/templates', {
      params: { branch_id: branchId },
    });
    return data;
  },

  getRoster: async (params: {
    branch_id: number;
    from: string;
    to: string;
  }): Promise<RosterGrid> => {
    const { data } = await apiClient.get('/admin/hr/roster', { params });
    return data;
  },

  saveRoster: async (payload: {
    branch_id: number;
    cells: Array<{
      employee_id: number;
      work_date: string;
      template_id?: number | null;
      is_weekly_off?: boolean;
      is_holiday?: boolean;
    }>;
  }): Promise<{ written: number; cleared: number }> => {
    const { data } = await apiClient.put('/admin/hr/roster', payload);
    return data;
  },

  labourCostReport: async (params: {
    from: string;
    to: string;
    branch_id?: number;
    brand_id?: number;
  }): Promise<LabourCostReport> => {
    const { data } = await apiClient.get('/admin/hr/reports/labour-cost', {
      params,
    });
    return data;
  },

  listHrAlerts: async (): Promise<HrAlerts> => {
    const { data } = await apiClient.get('/admin/hr/alerts');
    return data;
  },

  listTrainingRequirements: async (
    designationId?: number,
  ): Promise<TrainingRequirementRow[]> => {
    const { data } = await apiClient.get('/admin/hr/training/requirements', {
      params: { designation_id: designationId },
    });
    return data;
  },

  setTrainingRequirement: async (payload: {
    designation_id: number;
    program_id: number;
    required_for?: 'promotion_into' | 'holding_role';
    min_score?: number;
  }): Promise<{ id: number; updated: boolean }> => {
    const { data } = await apiClient.post('/admin/hr/training/requirements', payload);
    return data;
  },

  removeTrainingRequirement: async (id: number): Promise<{ deleted: boolean }> => {
    const { data } = await apiClient.delete(`/admin/hr/training/requirements/${id}`);
    return data;
  },

  trainingReadiness: async (
    employeeId: number,
    designationId: number,
  ): Promise<{
    ready: boolean;
    missing: Array<{ programId: number; programName: string; reason: string }>;
  }> => {
    const { data } = await apiClient.get(
      `/admin/hr/training/readiness/${employeeId}/${designationId}`,
    );
    return data;
  },

  listDesignations: async (includeInactive = false): Promise<Designation[]> => {
    const { data } = await apiClient.get('/admin/hr/settings/designations', {
      params: includeInactive ? { include_inactive: 1 } : {},
    });
    return data;
  },

  createDesignation: async (payload: Partial<Designation>): Promise<{ id: number }> => {
    const { data } = await apiClient.post('/admin/hr/settings/designations', payload);
    return data;
  },

  updateDesignation: async (id: number, payload: Partial<Designation>): Promise<{ id: number }> => {
    const { data } = await apiClient.put(`/admin/hr/settings/designations/${id}`, payload);
    return data;
  },

  deleteDesignation: async (
    id: number,
  ): Promise<{ deleted: boolean; deactivated: boolean; reason?: string }> => {
    const { data } = await apiClient.delete(`/admin/hr/settings/designations/${id}`);
    return data;
  },
};
