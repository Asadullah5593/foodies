# Order Assignment and Rider HRM

This document explains how rider HRM and automatic order assignment work in the system, what must be configured before dispatch starts working, and how admin users should operate the feature.

## Overview

The system now supports:

- rider HR profiles,
- rider check-in / check-out and live duty status,
- rider compensation plans,
- payroll runs for custom date ranges,
- automatic rider assignment for delivery orders when kitchen status enters **preparing** (from placed or accepted), using strict round-robin,
- manual retry of automatic assignment for old unassigned delivery orders,
- optional customer comment on rider delivery ratings.

## Core Rule

Automatic assignment only applies to **delivery** orders.

When a delivery order’s kitchen status becomes **`preparing`** from **`placed`** or **`accepted`** (via Admin order status update or Kitchen/KDS), the backend:

1. finds eligible riders for that branch,
2. filters out riders who are not currently dispatch-ready,
3. chooses the next eligible rider using **strict round-robin**,
4. assigns the rider and sets delivery status to `accepted`.

New delivery orders are **not** assigned a rider at placement; that gives the kitchen time to start work before dispatch pings a rider.

## Round-Robin Logic

The algorithm is strict round-robin over the current eligible rider pool:

- if eligible riders are `[R1, R2, R3]`,
- first eligible order goes to `R1`,
- next to `R2`,
- next to `R3`,
- then back to `R1`.

If one rider is temporarily ineligible, the system skips them for that cycle and continues rotating among the remaining eligible riders.

## Rider Eligibility for Automatic Assignment

A rider is eligible only when all required conditions are satisfied:

- rider is assigned to the branch with the `rider` role,
- rider has an active HR profile,
- rider is checked in,
- rider is not paused,
- rider heartbeat is fresh,
- rider location is fresh,
- rider is within the branch delivery radius,
- rider has not exceeded `max_active_orders`,
- rider does not violate any configured rating or timely-delivery thresholds.

If no riders meet all conditions, the order remains unassigned and a failed dispatch ledger record is created.

## Important Operational Note

Auto-assignment runs when the order **enters `preparing`** from `placed` or `accepted`, not when the customer or POS first places the order.

If riders were not yet eligible at that moment, or nobody moved the order to `preparing` yet, the order can remain without a rider. For such cases:

- go to **Admin -> Orders**
- use **Retry auto-assign**

That will re-run the same backend eligibility and round-robin logic for the selected unassigned delivery order (typically while the order is still in `preparing` or earlier).

## Branch Configuration Requirements

For dispatch to work correctly, the branch must have:

- delivery enabled,
- branch latitude,
- branch longitude,
- delivery radius in kilometers.

These settings are now configurable in the branch edit screen.

## Rider HRM Module

The Admin Rider HRM page supports the following areas.

### 1. Rider Profiles

Admin can create/update rider HR profiles with:

- employment status,
- salary type,
- employee code,
- base salary,
- default per-ride commission,
- max active orders,
- minimum rating,
- minimum timely-delivery rate.

### 2. Attendance and On-Duty Status

Admin can:

- check a rider in,
- check a rider out,
- see which riders are currently on duty,
- see branch and freshness timestamps.

Rider presence data is part of dispatch eligibility. **Break** is not a separate table: the `rider_presences` row for the rider stores `is_paused` (boolean) and `pause_reason` (optional text) while they remain checked in.

For browser-based testing, the rider web app now requests live GPS access after the rider is checked in and keeps sending heartbeat coordinates automatically. If the browser blocks location permission, or the app is not running on HTTPS or localhost, the rider will remain visible as on duty but may fail live-location eligibility checks for automatic dispatch.

### 3. Compensation Plans

Admin can create rider compensation plans with dynamic components, including:

- fixed salary,
- per-ride commission,
- timely-delivery bonuses,
- rating-threshold bonuses,
- additional custom earning components.

Only one plan per scope should normally be active at a time.

### 4. Payroll Runs

Admin can run payroll for a custom date range with optional branch scope.

Each run stores:

- attendance minutes,
- completed rides,
- timely deliveries,
- average rating,
- line-item compensation breakdown,
- final payable amount.

Payroll runs are stored as snapshots so the result can be audited later.

### 5. Ops Metrics

The system tracks operational counters such as:

- auto-assignment success count,
- auto-assignment no-eligible-rider count,
- assignment latency p95,
- payroll reversal count.

## Manual Assignment

Manual assignment is still supported from the Orders page.

This is useful for:

- operational exceptions,
- rider-specific handling,
- branches with temporary dispatch issues,
- fallback when no riders are eligible automatically.

Manual assignment and changes are also written to the assignment ledger.

## Assignment Ledger and Audit Trail

The backend records assignment events in `rider_assignment_ledger`.

This includes:

- auto assignment,
- manual assignment,
- manual rider changes,
- failed automatic assignment attempts,
- eligible rider list,
- skipped rider reasons,
- selected rider,
- reason codes.

This makes dispatch behavior traceable and debuggable.

## Payroll Audit Trail

Payroll runs are stored using:

- `rider_payroll_runs`
- `rider_payroll_lines`
- `rider_payroll_line_items`

This ensures each payout can be reviewed by run, rider, and line item.

Reversals are stored explicitly instead of silently changing finalized payroll data.

## Customer Rider Ratings

Customers can rate riders after delivery is completed.

Rider ratings now support:

- star rating,
- optional delivery comment.

These ratings can be used in rider performance evaluation and compensation rules.

## Recommended Admin Workflow

Use this sequence when setting up dispatch for a branch:

1. Configure branch delivery, coordinates, and delivery radius.
2. Assign users to the branch with rider role.
3. Create rider HR profiles.
4. Check riders in through Rider HRM.
5. Open the rider web app and allow browser location access so rider attendance heartbeat is active.
6. Place a new delivery order (rider is not assigned yet).
7. Move the order to **Preparing** from **Placed** or **Accepted** (Admin or Kitchen/KDS) and verify a rider was auto-assigned.
8. Use **Retry auto-assign** for delivery orders that stayed unassigned after step 7 if needed.

## Limitations

Current behavior intentionally keeps some boundaries:

- auto-assignment is for delivery orders only,
- auto-assignment runs when status becomes `preparing` from `placed` or `accepted`, not at order creation,
- unassigned delivery orders may need **Retry auto-assign** if riders became eligible later or the first attempt failed,
- rider eligibility depends on live presence data,
- frontend HRM currently focuses on core operational workflows rather than advanced reporting.

## Summary

The HRM and automatic assignment flow now works as a connected system:

- branch dispatch settings define delivery area,
- rider HR profile defines dispatch and payroll thresholds,
- rider attendance/presence determines availability,
- round-robin selects the next eligible rider,
- payroll uses rider activity and rules to calculate payable amounts,
- audit logs keep dispatch and payroll actions traceable.
