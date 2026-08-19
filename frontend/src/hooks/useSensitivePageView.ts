import { useEffect, useRef } from 'react';
import { recordBeacon } from '../utils/activityBeacon';

/**
 * Records that someone opened a screen holding sensitive data — customer phone
 * numbers, salaries, till cash, the audit trail itself.
 *
 * The server already logs the API calls those screens make, so why this? Because
 * a request tells you data was *fetched*; this tells you a person *looked*. When
 * the question is "who has been going through the customer list", the second is
 * the one that answers it.
 *
 * Fires once per mount, not per render, and never on a re-render caused by
 * filtering — otherwise a busy screen would write a row per keystroke.
 */
export function useSensitivePageView(subject: string, enabled = true): void {
  const reported = useRef(false);

  useEffect(() => {
    if (!enabled || reported.current) return;
    reported.current = true;
    recordBeacon({ action: 'client.page-view', subject });
  }, [subject, enabled]);
}
