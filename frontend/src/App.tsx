import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import Login from './pages/Admin/Login';
import Dashboard from './pages/Admin/Dashboard';
import Tenants from './pages/Admin/Tenants';
import Brands from './pages/Admin/Brands';
import Branches from './pages/Admin/Branches';
import BranchEdit from './pages/Admin/BranchEdit';
import Users from './pages/Admin/Users';
import Categories from './pages/Admin/Categories';
import MenuItems from './pages/Admin/MenuItems';
import Deals from './pages/Admin/Deals';
import MenuVariants from './pages/Admin/MenuVariants';
import MenuAddons from './pages/Admin/MenuAddons';
import Modifiers from './pages/Admin/Modifiers';
import BranchMenuItems from './pages/Admin/BranchMenuItems';
import BranchUsers from './pages/Admin/BranchUsers';
import Discounts from './pages/Admin/Discounts';
import Roles from './pages/Admin/Roles';
import Shifts from './pages/Admin/Shifts';
import Reports from './pages/Admin/Reports';
import Orders from './pages/Admin/Orders';
import OrderDetail from './pages/Admin/OrderDetail';
import Deliveries from './pages/Admin/Deliveries';
import RiderHRM from './pages/Admin/RiderHRM';
import LoyaltySettings from './pages/Admin/LoyaltySettings';
import BusinessSettings from './pages/Admin/BusinessSettings';
import Customers from './pages/Admin/Customers';
import InventoryOnHand from './pages/Admin/Inventory/InventoryOnHand';
import InventoryLedger from './pages/Admin/Inventory/InventoryLedger';
import InventoryAlerts from './pages/Admin/Inventory/InventoryAlerts';
import InventoryTransfers from './pages/Admin/Inventory/InventoryTransfers';
import InventoryAdjustments from './pages/Admin/Inventory/InventoryAdjustments';
import InventoryWastage from './pages/Admin/Inventory/InventoryWastage';
import InventoryStocktake from './pages/Admin/Inventory/InventoryStocktake';
import InventoryWeeklyUsage from './pages/Admin/Inventory/InventoryWeeklyUsage';
import InventoryItems from './pages/Admin/Inventory/InventoryItems';
import InventoryVendors from './pages/Admin/Inventory/InventoryVendors';
import InventoryUoms from './pages/Admin/Inventory/InventoryUoms';
import ProcurementPRs from './pages/Admin/Procurement/ProcurementPRs';
import ProcurementPOs from './pages/Admin/Procurement/ProcurementPOs';
import ProcurementGRNs from './pages/Admin/Procurement/ProcurementGRNs';
import RecipesManage from './pages/Admin/Recipes/RecipesManage';
import RecipesCosting from './pages/Admin/Recipes/RecipesCosting';
import OrderTaking from './pages/POS/OrderTaking';
import KitchenDisplay from './pages/Kitchen/KitchenDisplay';
import KDS from './pages/Kitchen/KDS';
import FOHPacking from './pages/FOH/Packing';
import RiderLayout from './pages/Rider/RiderLayout';
import RiderDashboard from './pages/Rider/RiderDashboard';
import RiderOrderDetail from './pages/Rider/RiderOrderDetail';
import ButtonDemo from './pages/Admin/ButtonDemo';

const PageLoader: React.FC = () => (
  <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center gap-4"
    >
      <motion.div
        className="w-10 h-10 border-2 border-red-500 border-t-transparent rounded-full"
        animate={{ rotate: 360 }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
      />
      <span className="text-sm text-slate-500 dark:text-slate-400">Loading...</span>
    </motion.div>
  </div>
);

const NAV_LOADER_FADE_IN_MS = 250;
const NAV_LOADER_MIN_VISIBLE_MS = 500;
const NAV_LOADER_FADE_OUT_MS = 250;

/** Full-screen spinner when navigating between routes. Visible at least 1s with smooth fade in/out. */
const NavigationLoaderOverlay: React.FC<{ show: boolean }> = ({ show }) => (
  <AnimatePresence>
    {show && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: NAV_LOADER_FADE_OUT_MS / 1000, ease: 'easeInOut' } }}
        transition={{ duration: NAV_LOADER_FADE_IN_MS / 1000, ease: 'easeInOut' }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm"
        role="status"
        aria-live="polite"
        aria-label="Loading"
      >
        <div className="flex flex-col items-center gap-3">
          <motion.div
            className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 dark:border-slate-600 dark:border-t-blue-400 rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          <span className="text-sm font-medium text-gray-600 dark:text-slate-300">Loading...</span>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
);

/** Wraps app content and shows full-screen loader on route change (min 1s, smooth transition). */
const NavigationLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const [showLoader, setShowLoader] = useState(false);
  const prevPathRef = useRef(location.pathname);

  useEffect(() => {
    if (prevPathRef.current === location.pathname) return;
    prevPathRef.current = location.pathname;
    setShowLoader(true);
    const t = setTimeout(
      () => setShowLoader(false),
      NAV_LOADER_FADE_IN_MS + NAV_LOADER_MIN_VISIBLE_MS
    );
    return () => clearTimeout(t);
  }, [location.pathname]);

  return (
    <>
      <NavigationLoaderOverlay show={showLoader} />
      {children}
    </>
  );
};

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

/** Redirect riders away from admin area. */
const AdminOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  if (isRiderForAccess(user)) {
    return <Navigate to="/rider" replace />;
  }
  return <>{children}</>;
};

import { canAccessPath, isRiderForAccess, getDefaultLandingPath } from './lib/pathPermissions';

/** Only super admin can access (e.g. Tenants module). Tenant users are redirected to first accessible module. */
const SuperAdminOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  if (user && !user.is_super_admin) {
    return <Navigate to={getDefaultLandingPath(user)} replace />;
  }
  return <>{children}</>;
};

/** Redirect non-riders away from rider area. */
const RiderOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  if (user && !isRiderForAccess(user)) {
    return <Navigate to={getDefaultLandingPath(user)} replace />;
  }
  return <>{children}</>;
};

const DefaultRedirect: React.FC = () => {
  const { isAuthenticated, loading, user } = useAuth();
  if (loading) return <PageLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={getDefaultLandingPath(user)} replace />;
};

const SIDEBAR_WIDTH = 280;
const SIDEBAR_COLLAPSED_WIDTH = 72;
const SIDEBAR_COLLAPSED_KEY = 'foodies-sidebar-collapsed';

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { logout, user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [routeChanging, setRouteChanging] = useState(false);

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    setRouteChanging(true);
    const t = setTimeout(() => setRouteChanging(false), 400);
    return () => clearTimeout(t);
  }, [location.pathname]);

  const handleLogout = async () => {
    queryClient.clear();
    await logout();
    navigate('/login');
  };

  const isSuperAdmin = user?.is_super_admin === true;
  const isTenantUser = user?.tenant_id != null;

  type MenuLink = { type: 'link'; path: string; label: string; icon: string };
  type MenuGroup = {
    type: 'group';
    id: 'inventory' | 'procurement' | 'recipes';
    label: string;
    icon: string;
    children: Array<{ path: string; label: string }>;
  };
  type MenuItem = MenuLink | MenuGroup;

  const allMenuItems: MenuItem[] = [
    { path: '/admin/dashboard', label: 'Dashboard', icon: '📊' as const },
    ...(isSuperAdmin ? [{ path: '/admin/tenants', label: 'Tenants', icon: '🏢' as const }] : []),
    ...(isTenantUser ? [{ path: '/admin/business-settings', label: 'Business Settings', icon: '⚙️' as const }] : []),
    { path: '/admin/brands', label: 'Brands', icon: '🏪' as const },
    { path: '/admin/branches', label: 'Branches', icon: '📍' as const },
    { path: '/admin/users', label: 'Users', icon: '👥' as const },
    { path: '/admin/categories', label: 'Categories', icon: '📁' as const },
    { path: '/admin/menu-items', label: 'Menu Items', icon: '🍽️' as const },
    { path: '/admin/deals', label: 'Deals', icon: '🎁' as const },
    { path: '/admin/menu-variants', label: 'Variants', icon: '🔀' as const },
    { path: '/admin/menu-addons', label: 'Addons', icon: '➕' as const },
    { path: '/admin/modifiers', label: 'Modifiers', icon: '🔧' as const },
    { path: '/admin/branch-menu-items', label: 'Branch Pricing', icon: '💰' as const },
    { path: '/admin/branch-users', label: 'Branch Users', icon: '👤' as const },
    { path: '/admin/discounts', label: 'Discounts', icon: '🎫' as const },
    { path: '/admin/loyalty-settings', label: 'Loyalty Settings', icon: '⭐' as const },
    { path: '/admin/customers', label: 'Customers', icon: '👤' as const },
    { path: '/admin/roles', label: 'Roles', icon: '🔐' as const },
    { path: '/admin/orders', label: 'Orders', icon: '📋' as const },
    { path: '/admin/deliveries', label: 'Deliveries', icon: '🛵' as const },
    { path: '/admin/rider-hrm', label: 'Rider HRM', icon: '🧑‍💼' as const },
    { path: '/admin/shifts', label: 'Shifts', icon: '⏰' as const },
    { path: '/admin/reports', label: 'Reports', icon: '📈' as const },
    {
      type: 'group',
      id: 'inventory',
      label: 'Inventory',
      icon: '📦',
      children: [
        { path: '/admin/inventory/uoms', label: 'Units of measure' },
        { path: '/admin/inventory/vendors', label: 'Vendors' },
        { path: '/admin/inventory/items', label: 'Inventory items' },
        { path: '/admin/inventory/on-hand', label: 'On-hand inventory' },
        { path: '/admin/inventory/ledger', label: 'Stock movement ledger' },
        { path: '/admin/inventory/transfers', label: 'Branch transfers' },
        { path: '/admin/inventory/adjustments', label: 'Stock adjustment' },
        { path: '/admin/inventory/wastage', label: 'Record wastage' },
        // { path: '/admin/inventory/alerts', label: 'Alerts (low stock & expiry)' },
        // { path: '/admin/inventory/stocktake', label: 'Weekly stock count (Finance Day)' },
        // { path: '/admin/inventory/weekly-usage', label: 'Weekly usage report' },
      ],
    },
    {
      type: 'group',
      id: 'procurement',
      label: 'Procurement',
      icon: '🧾',
      children: [
        { path: '/admin/procurement/prs', label: 'Purchase requisitions' },
        { path: '/admin/procurement/pos', label: 'Purchase orders' },
        { path: '/admin/procurement/grns', label: 'Goods receipt notes' },
      ],
    },
    {
      type: 'group',
      id: 'recipes',
      label: 'Recipes',
      icon: '🧪',
      children: [
        { path: '/admin/recipes/manage', label: 'Recipe builder' },
        { path: '/admin/recipes/costing', label: 'Costing & margin' },
      ],
    },
    { path: '/pos/orders', label: 'POS', icon: '🛒' as const },
    { path: '/kitchen', label: 'Customer Display', icon: '📺' as const },
    { path: '/kitchen/back', label: 'Back Kitchen', icon: '🍳' as const },
    { path: '/foh/packing', label: 'FOH Packing', icon: '📦' as const },
    // { path: '/admin/button-demo', label: 'Button demo', icon: '🎨' as const },
  ].map((it: any) => (it.type ? it : ({ ...it, type: 'link' } as MenuLink)));

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    inventory: location.pathname.startsWith('/admin/inventory'),
    procurement: location.pathname.startsWith('/admin/procurement'),
    recipes: location.pathname.startsWith('/admin/recipes'),
  });

  useEffect(() => {
    setExpandedGroups((prev) => ({
      ...prev,
      inventory: location.pathname.startsWith('/admin/inventory') ? true : prev.inventory,
      procurement: location.pathname.startsWith('/admin/procurement') ? true : prev.procurement,
      recipes: location.pathname.startsWith('/admin/recipes') ? true : prev.recipes,
    }));
  }, [location.pathname]);

  const menuItems: MenuItem[] = isRiderForAccess(user)
    ? [{ type: 'link', path: '/rider', label: 'Deliveries', icon: '🛵' }]
    : allMenuItems
        .map((item) => {
          if (item.type === 'link') return canAccessPath(user, item.path) ? item : null;
          const allowedChildren = item.children.filter((c) => canAccessPath(user, c.path));
          return allowedChildren.length ? { ...item, children: allowedChildren } : null;
        })
        .filter(Boolean) as MenuItem[];

  const pathname = location.pathname;
  const flatLinks: MenuLink[] = menuItems.flatMap((item) =>
    item.type === 'link'
      ? [item]
      : item.children.map((c) => ({ type: 'link', path: c.path, label: c.label, icon: item.icon })),
  );
  const matchingPaths = flatLinks.filter((l) => pathname === l.path || pathname.startsWith(l.path + '/'));
  const activePath = matchingPaths.length > 0 ? matchingPaths.sort((a, b) => b.path.length - a.path.length)[0].path : null;
  const isActive = (path: string) => path === activePath;
  const isPOS = pathname === '/pos' || pathname.startsWith('/pos/');
  const basePath = pathname.startsWith('/admin/orders/') ? '/admin/orders' : pathname.startsWith('/admin/branches/') ? '/admin/branches' : pathname;
  if (!canAccessPath(user, basePath)) {
    return <Navigate to={getDefaultLandingPath(user)} replace />;
  }

  const isDarkSidebar = theme === 'dark';
  const sidebarBorder = isDarkSidebar ? 'border-white/10' : 'border-slate-200';
  const sidebarMuted = isDarkSidebar ? 'text-slate-400' : 'text-slate-500';
  const sidebarInactive = isDarkSidebar ? 'text-slate-300 hover:bg-white/10 hover:text-white' : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900';
  const sidebarLogoText = isDarkSidebar ? 'text-white' : 'text-slate-800';

  const renderSidebarContent = (collapsed: boolean) => (
    <>
      {/* Logo — top of sidebar */}
      <div className={`flex-shrink-0 border-b ${sidebarBorder} ${collapsed ? 'px-0 py-4 flex justify-center' : 'px-4 pt-6 pb-5'}`}>
        <Link
          to="/admin/dashboard"
          className={`flex items-center ${collapsed ? 'justify-center' : 'justify-center gap-3'}`}
          onClick={() => setSidebarOpen(false)}
          title={collapsed ? 'Foodies' : undefined}
        >
          <img
            src="/foodies-logo.png"
            alt="Foodies"
            className={`rounded-full object-contain flex-shrink-0 ${collapsed ? 'h-10 w-10' : 'h-12 w-12'}`}
          />
          {!collapsed && (
            <span className={`text-xl font-semibold ${sidebarLogoText} tracking-tight`}>Foodies</span>
          )}
        </Link>
      </div>

      {/* Nav links — scrollable */}
      <nav className={`flex-1 overflow-y-auto py-4 space-y-0.5 ${collapsed ? 'px-2' : 'px-3'}`}>
        {menuItems.map((item) => {
          if (item.type === 'link') {
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                title={collapsed ? item.label : undefined}
                className={`flex items-center rounded-lg text-sm font-medium transition-all duration-200 ${
                  collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-2.5'
                } ${
                  isActive(item.path) ? 'bg-red-600 text-white shadow-lg shadow-red-600/30' : sidebarInactive
                }`}
              >
                <span className="text-lg w-6 text-center flex-shrink-0">{item.icon}</span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          }

          const firstChild = item.children[0];
          const groupActive = item.children.some((c) => isActive(c.path));
          const expanded = !!expandedGroups[item.id];

          if (collapsed) {
            return (
              <Link
                key={item.id}
                to={firstChild?.path ?? '/admin/dashboard'}
                onClick={() => setSidebarOpen(false)}
                title={item.label}
                className={`flex items-center rounded-lg text-sm font-medium transition-all duration-200 justify-center px-0 py-2.5 ${
                  groupActive ? 'bg-red-600 text-white shadow-lg shadow-red-600/30' : sidebarInactive
                }`}
              >
                <span className="text-lg w-6 text-center flex-shrink-0">{item.icon}</span>
              </Link>
            );
          }

          return (
            <div key={item.id} className="space-y-1">
              <button
                type="button"
                onClick={() => setExpandedGroups((p) => ({ ...p, [item.id]: !p[item.id] }))}
                className={`w-full flex items-center rounded-lg text-sm font-medium transition-all duration-200 gap-3 px-3 py-2.5 ${
                  groupActive ? 'bg-red-600 text-white shadow-lg shadow-red-600/30' : sidebarInactive
                }`}
              >
                <span className="text-lg w-6 text-center flex-shrink-0">{item.icon}</span>
                <span className="truncate flex-1 text-left">{item.label}</span>
                <svg
                  className={`h-4 w-4 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : 'rotate-0'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="overflow-hidden pl-10 pr-2"
                  >
                    <div className="space-y-1 py-1">
                      {item.children.map((c) => (
                        <Link
                          key={c.path}
                          to={c.path}
                          onClick={() => setSidebarOpen(false)}
                          className={`block rounded-lg text-sm font-medium px-3 py-2 transition-colors ${
                            isActive(c.path)
                              ? theme === 'dark'
                                ? 'bg-white/15 text-white'
                                : 'bg-slate-200 text-slate-900'
                              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/10'
                          }`}
                        >
                          {c.label}
                        </Link>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      {/* Collapse/expand toggle — same position in both states so sequence stays consistent */}
      <div className={`flex-shrink-0 ${collapsed ? 'px-2 pb-2' : 'px-3 pb-2'}`}>
        <button
          type="button"
          onClick={toggleSidebarCollapsed}
          className={`w-full flex items-center rounded-lg font-medium text-sm transition-colors ${sidebarMuted} ${isDarkSidebar ? 'hover:bg-white/10 hover:text-white' : 'hover:bg-slate-200 hover:text-slate-800'} ${
            collapsed ? 'justify-center p-2.5' : 'justify-center gap-2 px-3 py-2'
          }`}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
              <span className="text-xs font-medium">Collapse</span>
            </>
          )}
        </button>
      </div>

      {/* Theme toggle — above user/logout */}
      <div className={`flex-shrink-0 ${collapsed ? 'px-2 pb-2' : 'px-3 pb-2'}`}>
        <button
          type="button"
          onClick={toggleTheme}
          className={`w-full flex items-center rounded-lg font-medium text-sm transition-colors ${sidebarMuted} ${isDarkSidebar ? 'hover:bg-white/10 hover:text-white' : 'hover:bg-slate-200 hover:text-slate-800'} ${
            collapsed ? 'justify-center p-2.5' : 'justify-center gap-2 px-3 py-2.5'
          }`}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <svg className="h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
          {!collapsed && <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>}
        </button>
      </div>

      {/* User & logout — bottom of sidebar */}
      <div className={`flex-shrink-0 border-t ${sidebarBorder} space-y-2 ${collapsed ? 'p-2' : 'p-4'}`}>
        {!collapsed && (
          <p className={`px-3 text-xs font-medium ${sidebarMuted} truncate`} title={user?.name}>
            {user?.name}
          </p>
        )}
        <button
          onClick={handleLogout}
          title={collapsed ? 'Logout' : undefined}
          className={`w-full flex items-center rounded-lg font-medium text-sm transition-all duration-200 text-white border-0 !bg-[linear-gradient(90deg,#000000_0%,#B91C1C_50%,#000000_100%)] hover:brightness-110 active:brightness-95 ${
            collapsed ? 'justify-center p-2.5' : 'justify-center gap-2 px-3 py-2.5'
          }`}
        >
          <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </>
  );

  const desktopSidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex">
      {/* Desktop: fixed vertical sidebar (collapsible, theme-aware) */}
      <motion.aside
        initial={false}
        animate={{ width: desktopSidebarWidth }}
        transition={{ type: 'tween', duration: 0.2 }}
        className={`hidden lg:flex flex-col fixed top-0 left-0 h-screen z-30 shadow-xl overflow-hidden ${
          theme === 'dark' ? 'bg-slate-900' : 'bg-slate-100'
        }`}
      >
        {renderSidebarContent(sidebarCollapsed)}
      </motion.aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile: slide-in drawer (always expanded, theme-aware) */}
      <motion.aside
        initial={false}
        animate={{ x: sidebarOpen ? 0 : -SIDEBAR_WIDTH }}
        transition={{ type: 'tween', duration: 0.25 }}
        className={`flex flex-col fixed top-0 left-0 h-screen w-[280px] max-w-[85vw] z-50 shadow-2xl lg:hidden ${
          theme === 'dark' ? 'bg-slate-900' : 'bg-slate-100'
        }`}
        style={{ width: SIDEBAR_WIDTH }}
      >
        {renderSidebarContent(false)}
      </motion.aside>

      {/* Main content — margin matches desktop sidebar width (mobile: no sidebar) */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-[margin] duration-200 ${
          sidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-[280px]'
        }`}
      >
        {/* Route change loader — thin progress bar at top of content area */}
        <div className="w-full h-1 flex-shrink-0 overflow-hidden">
          <div
            className="h-full w-full bg-red-500 origin-left"
            style={{
              transform: routeChanging ? 'scaleX(1)' : 'scaleX(0)',
              transition: 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        </div>
        <div className="flex-1 flex flex-col min-h-0">
          {/* Top bar: mobile menu + POS back */}
          <header className="flex-shrink-0 flex items-center justify-between h-14 px-4 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 lg:px-6">
            <div className="flex items-center gap-3">
              {!isPOS && (
                <>
                  <button
                    onClick={() => setSidebarOpen(true)}
                    className="lg:hidden p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                    aria-label="Open menu"
                  >
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </button>
                  {sidebarCollapsed && (
                    <button
                      onClick={toggleSidebarCollapsed}
                      className="hidden lg:flex items-center gap-2 p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                      aria-label="Expand sidebar"
                      title="Expand sidebar"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      </svg>
                      <span className="text-sm font-medium">Menu</span>
                    </button>
                  )}
                </>
              )}
              {isPOS && (
                <Link
                  to="/admin/orders"
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back to Orders
                </Link>
              )}
              <span className="text-slate-600 dark:text-slate-300 font-medium lg:hidden">
                {isPOS ? 'POS' : 'Foodies'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleTheme}
                className="p-2 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
              <span className="text-sm text-slate-600 dark:text-slate-400 truncate max-w-[120px] lg:hidden">{user?.name}</span>
            </div>
          </header>

          <main className="flex-1 p-4 lg:p-6 min-h-0 overflow-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="h-full"
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </div>
  );
};

const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/admin/dashboard"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute>
              <Layout><Dashboard /></Layout>
            </AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/tenants"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute>
              <SuperAdminOnlyRoute>
                <Layout><Tenants /></Layout>
              </SuperAdminOnlyRoute>
            </AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/business-settings"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><BusinessSettings /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/brands"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Brands /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/branches/:id"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><BranchEdit /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/branches"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Branches /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Users /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/categories"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Categories /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/menu-items"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><MenuItems /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/deals"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Deals /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/menu-variants"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><MenuVariants /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/menu-addons"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><MenuAddons /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/modifiers"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Modifiers /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/branch-menu-items"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><BranchMenuItems /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/branch-users"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><BranchUsers /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/discounts"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Discounts /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/loyalty-settings"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><LoyaltySettings /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/customers"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Customers /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/roles"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Roles /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/shifts"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Shifts /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/orders"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Orders /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/orders/:id"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><OrderDetail /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/deliveries"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Deliveries /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/rider-hrm"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><RiderHRM /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/reports"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Reports /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Navigate to="/admin/inventory/on-hand" replace /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route path="/admin/inventory/on-hand" element={<ProtectedRoute><AdminOnlyRoute><Layout><InventoryOnHand /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/inventory/ledger" element={<ProtectedRoute><AdminOnlyRoute><Layout><InventoryLedger /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/inventory/alerts" element={<ProtectedRoute><AdminOnlyRoute><Layout><InventoryAlerts /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/inventory/transfers" element={<ProtectedRoute><AdminOnlyRoute><Layout><InventoryTransfers /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/inventory/adjustments" element={<ProtectedRoute><AdminOnlyRoute><Layout><InventoryAdjustments /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/inventory/wastage" element={<ProtectedRoute><AdminOnlyRoute><Layout><InventoryWastage /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/inventory/stocktake" element={<ProtectedRoute><AdminOnlyRoute><Layout><InventoryStocktake /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/inventory/weekly-usage" element={<ProtectedRoute><AdminOnlyRoute><Layout><InventoryWeeklyUsage /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/inventory/items" element={<ProtectedRoute><AdminOnlyRoute><Layout><InventoryItems /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/inventory/vendors" element={<ProtectedRoute><AdminOnlyRoute><Layout><InventoryVendors /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/inventory/uoms" element={<ProtectedRoute><AdminOnlyRoute><Layout><InventoryUoms /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route
        path="/admin/procurement"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Navigate to="/admin/procurement/prs" replace /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route path="/admin/procurement/prs" element={<ProtectedRoute><AdminOnlyRoute><Layout><ProcurementPRs /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/procurement/pos" element={<ProtectedRoute><AdminOnlyRoute><Layout><ProcurementPOs /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/procurement/grns" element={<ProtectedRoute><AdminOnlyRoute><Layout><ProcurementGRNs /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route
        path="/admin/recipes"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Navigate to="/admin/recipes/manage" replace /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route path="/admin/recipes/manage" element={<ProtectedRoute><AdminOnlyRoute><Layout><RecipesManage /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/recipes/costing" element={<ProtectedRoute><AdminOnlyRoute><Layout><RecipesCosting /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route path="/admin/button-demo" element={<ProtectedRoute><AdminOnlyRoute><Layout><ButtonDemo /></Layout></AdminOnlyRoute></ProtectedRoute>} />
      <Route
        path="/kitchen"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><KitchenDisplay /></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/kitchen/back"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><KDS /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/foh/packing"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><FOHPacking /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/pos/orders"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><OrderTaking /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/rider"
        element={
          <ProtectedRoute>
            <RiderOnlyRoute>
              <RiderLayout />
            </RiderOnlyRoute>
          </ProtectedRoute>
        }
      >
        <Route index element={<RiderDashboard />} />
        <Route path="orders/:id" element={<RiderOrderDetail />} />
      </Route>
      <Route path="/" element={<DefaultRedirect />} />
    </Routes>
  );
};

const App: React.FC = () => {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <ThemeProvider>
        <AuthProvider>
          <NavigationLoader>
            <AppRoutes />
          </NavigationLoader>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
};

export default App;
