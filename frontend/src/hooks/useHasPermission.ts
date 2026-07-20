import { useAuth } from '../contexts/AuthContext';

/**
 * Permission check for gating action buttons (create/edit/delete/etc.).
 *
 * The backend already expands umbrella permissions (e.g. `menu:manage`) into the
 * granular ones they imply before returning `user.permissions`, so this only
 * needs a membership check plus the super-admin bypass. Owner accounts receive
 * every permission from the server, so they pass too.
 *
 * Pass a single permission or an array (any-of). No argument / empty array = true
 * (nothing required).
 */
export function hasPermission(
  user: { is_super_admin?: boolean; permissions?: string[] } | null,
  permission?: string | string[],
): boolean {
  if (!user) return false;
  if (user.is_super_admin) return true;
  if (permission == null) return true;
  const needed = Array.isArray(permission) ? permission : [permission];
  if (needed.length === 0) return true;
  const held = user.permissions ?? [];
  return needed.some((p) => held.includes(p));
}

/** Hook form: `const canCreate = useHasPermission('menu:create')`. */
export function useHasPermission(permission?: string | string[]): boolean {
  const { user } = useAuth();
  return hasPermission(user, permission);
}
