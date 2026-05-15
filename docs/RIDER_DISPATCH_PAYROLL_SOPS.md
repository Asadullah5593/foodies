# Rider Dispatch & Payroll SOPs

## Dispatch SLOs
- `assignment_latency_ms` p95 under 1500 ms during normal load.
- Auto-assignment success ratio above 98%.
- `auto_assignment_no_eligible_riders` alerts if branch stays non-zero for 15 minutes in delivery hours.

## Availability Controls
- Rider is dispatch-eligible only when:
  - checked-in,
  - not paused,
  - heartbeat freshness <= 90 seconds,
  - location freshness <= 120 seconds,
  - active-order cap not exceeded.
- Reconcile stale riders with periodic checks and force-unavailable state.

## Dispatch Incident Fallback
1. If auto-assignment fails, order stays unassigned with a ledger entry.
2. Operations team uses admin manual assignment endpoint.
3. Review `rider_assignment_ledger` event history for the order.
4. Requeue assignment only after rider presence or branch setup is corrected.

## Payroll SLOs
- Payroll run completion under 5 minutes for expected rider volume.
- `payroll_run_reversal_count` should remain low; investigate spikes immediately.
- Zero reconciliation mismatch between payroll line totals and line-item sums.

## Payroll Dispute Process
1. Open payroll run details and inspect immutable line items.
2. Validate attendance, ride count, timely deliveries, and rating inputs.
3. If correction is required after finalization, post explicit reversal entry.
4. Rerun payroll for the target range with corrected inputs and retain both runs.

## Core Audit Sources
- `rider_assignment_ledger`
- `rider_payroll_runs`
- `rider_payroll_lines`
- `rider_payroll_line_items`
