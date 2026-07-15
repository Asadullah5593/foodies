import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface NoRidersForBrandNoticeProps {
  /** Brand the order belongs to; falls back to generic wording when unknown. */
  brandName?: string | null;
  onNavigate?: () => void;
}

/**
 * Shown in the assign-rider modals when no rider is linked to the order's brand.
 * Owner/GM manage the shared pool themselves; brand-locked admins can only
 * request a rider from it, so each is sent to the screen they can actually use
 * (mirrors the Rider HRM nav gating in App.tsx).
 */
const NoRidersForBrandNotice: React.FC<NoRidersForBrandNoticeProps> = ({
  brandName,
  onNavigate,
}) => {
  const { user } = useAuth();
  const isBrandLocked = Array.isArray(user?.allowed_brand_ids);
  const target = isBrandLocked
    ? '/admin/rider-hrm/request-riders'
    : '/admin/rider-hrm/pool-sharing';
  const linkLabel = isBrandLocked ? 'Request riders' : 'Rider pool & sharing';

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
      <p className="text-sm text-amber-700 dark:text-amber-400">
        No riders are linked to{' '}
        <span className="font-medium">{brandName ?? "this order's brand"}</span>, so
        there is nobody to assign yet.
      </p>
      <Link
        to={target}
        onClick={onNavigate}
        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200"
      >
        {isBrandLocked ? 'Request a rider' : 'Link a rider'} in Rider HRM → {linkLabel}
        <span aria-hidden="true">↗</span>
      </Link>
    </div>
  );
};

export default NoRidersForBrandNotice;
