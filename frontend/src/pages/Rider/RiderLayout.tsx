import React, { useState } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { motion } from 'framer-motion';
import Button from '../../components/Button';

const RiderLayout: React.FC = () => {
  const { logout, user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [_menuOpen, _setMenuOpen] = useState(false);

  const handleLogout = async () => {
    queryClient.clear();
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-slate-900">
      <nav className="bg-white dark:bg-slate-800 shadow border-b border-gray-200 dark:border-slate-700 sticky top-0 z-40">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14">
            <Link
              to="/rider"
              className="text-lg font-bold text-gray-800 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            >
              🛵 Rider
            </Link>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleTheme}
                className="p-2 rounded-lg text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
                aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
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
              <span className="text-sm font-medium text-gray-700 dark:text-slate-200 hidden sm:inline">{user?.name}</span>
              <Button type="button" variant="gradient" size="small" onClick={handleLogout}>
                Logout
              </Button>
            </div>
          </div>
        </div>
      </nav>
      <main>
        <motion.div
          initial={false}
          animate={{ opacity: 1 }}
          className="min-h-0"
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
};

export default RiderLayout;
