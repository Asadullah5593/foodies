import React from 'react';

/**
 * "Inactive" marker for a record offered as a selectable option — a dropdown
 * row, a checkbox list, a filter pill.
 *
 * The list pages already say active/inactive on every row (AccentedListRow);
 * the same record picked from a dropdown said nothing, so a deactivated brand
 * or category was indistinguishable from a live one. These are the rose tones
 * AccentedListRow uses for `inactive`, so a dropdown row reads like a list row.
 *
 * Only the inactive state is drawn. Badging every active option too would put a
 * green pill on nearly every row of every dropdown in the admin panel and make
 * the exception harder to spot, not easier.
 */
const InactiveBadge: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span
    className={`inline-flex shrink-0 items-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-none tracking-wide text-rose-800 dark:bg-rose-900/50 dark:text-rose-300 ${className}`}
  >
    Inactive
  </span>
);

export default InactiveBadge;
