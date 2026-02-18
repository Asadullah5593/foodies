import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './pages/Admin/Login';
import Dashboard from './pages/Admin/Dashboard';
import Tenants from './pages/Admin/Tenants';
import Brands from './pages/Admin/Brands';
import Branches from './pages/Admin/Branches';
import Users from './pages/Admin/Users';
import Categories from './pages/Admin/Categories';
import MenuItems from './pages/Admin/MenuItems';
import MenuVariants from './pages/Admin/MenuVariants';
import MenuAddons from './pages/Admin/MenuAddons';
import BranchMenuItems from './pages/Admin/BranchMenuItems';
import BranchUsers from './pages/Admin/BranchUsers';
import Discounts from './pages/Admin/Discounts';
import Roles from './pages/Admin/Roles';
import Shifts from './pages/Admin/Shifts';
import Reports from './pages/Admin/Reports';
import Orders from './pages/Admin/Orders';
import OrderDetail from './pages/Admin/OrderDetail';
import Deliveries from './pages/Admin/Deliveries';
import LoyaltySettings from './pages/Admin/LoyaltySettings';
import Customers from './pages/Admin/Customers';
import OrderTaking from './pages/POS/OrderTaking';
import KDS from './pages/Kitchen/KDS';
import RiderLayout from './pages/Rider/RiderLayout';
import RiderDashboard from './pages/Rider/RiderDashboard';
import RiderOrderDetail from './pages/Rider/RiderOrderDetail';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

/** Redirect riders away from admin area. */
const AdminOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  if (user?.is_rider) {
    return <Navigate to="/rider" replace />;
  }
  return <>{children}</>;
};

/** Redirect non-riders away from rider area. */
const RiderOnlyRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  if (user && !user.is_rider) {
    return <Navigate to="/admin/dashboard" replace />;
  }
  return <>{children}</>;
};

const DefaultRedirect: React.FC = () => {
  const { isAuthenticated, loading, user } = useAuth();
  if (loading) return <div>Loading...</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.is_rider) return <Navigate to="/rider" replace />;
  return <Navigate to="/admin/dashboard" replace />;
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    // Clear cached data so the next user never sees this user's data
    queryClient.clear();
    await logout();
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path;

  const menuLinks = [
    { path: '/admin/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/admin/tenants', label: 'Tenants', icon: '🏢' },
    { path: '/admin/brands', label: 'Brands', icon: '🏪' },
    { path: '/admin/branches', label: 'Branches', icon: '📍' },
    { path: '/admin/users', label: 'Users', icon: '👥' },
    { path: '/admin/categories', label: 'Categories', icon: '📁' },
    { path: '/admin/menu-items', label: 'Menu Items', icon: '🍽️' },
    { path: '/admin/menu-variants', label: 'Variants', icon: '🔀' },
    { path: '/admin/menu-addons', label: 'Addons', icon: '➕' },
    { path: '/admin/branch-menu-items', label: 'Branch Pricing', icon: '💰' },
    { path: '/admin/branch-users', label: 'Branch Users', icon: '👤' },
    { path: '/admin/discounts', label: 'Discounts', icon: '🎫' },
    { path: '/admin/loyalty-settings', label: 'Loyalty Settings', icon: '⭐' },
    { path: '/admin/customers', label: 'Customers', icon: '👤' },
    { path: '/admin/roles', label: 'Roles', icon: '🔐' },
    { path: '/admin/orders', label: 'Orders', icon: '📋' },
    { path: '/admin/deliveries', label: 'Deliveries', icon: '🛵' },
    { path: '/admin/shifts', label: 'Shifts', icon: '⏰' },
    { path: '/admin/reports', label: 'Reports', icon: '📈' },
    { path: '/pos/orders', label: 'POS', icon: '🛒' },
    { path: '/kitchen', label: 'KDS', icon: '🍳' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-md border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="md:hidden p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
              >
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <h1 className="ml-2 text-xl font-bold text-gray-800">Restaurant Management</h1>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-700">{user?.name}</span>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden border-t border-gray-200"
          >
            <div className="px-2 pt-2 pb-3 space-y-1">
              {menuLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setMenuOpen(false)}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-colors ${
                    isActive(link.path)
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="mr-2">{link.icon}</span>
                  {link.label}
                </Link>
              ))}
            </div>
          </motion.div>
        )}

        {/* Desktop Menu */}
        <div className="hidden md:block border-t border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex space-x-1 overflow-x-auto">
              {menuLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive(link.path)
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                  }`}
                >
                  <span className="mr-1">{link.icon}</span>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </nav>
      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {children}
      </motion.main>
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
            <AdminOnlyRoute><Layout><Tenants /></Layout></AdminOnlyRoute>
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
        path="/admin/reports"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><Reports /></Layout></AdminOnlyRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/kitchen"
        element={
          <ProtectedRoute>
            <AdminOnlyRoute><Layout><KDS /></Layout></AdminOnlyRoute>
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
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
