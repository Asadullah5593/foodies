import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { getDefaultLandingPath } from '../../lib/pathPermissions';
import { motion } from 'framer-motion';
import Button from '../../components/Button';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.2 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

const features = [
  { icon: '📋', text: 'Orders & POS', delay: 0.1 },
  { icon: '🍽️', text: 'Menu & catalog', delay: 0.2 },
  { icon: '📊', text: 'Reports & analytics', delay: 0.3 },
  { icon: '👥', text: 'Team & branches', delay: 0.4 },
];

const Login: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const user = await login(email, password);
      queryClient.clear();
      const landing = getDefaultLandingPath(user ?? null);
      navigate(landing);
    } catch (err: any) {
      if (err.code === 'ERR_NETWORK' || err.code === 'ERR_CONNECTION_REFUSED') {
        setError('Cannot connect to server. Please ensure the backend is running on http://127.0.0.1:3001');
      } else {
        setError(err.response?.data?.message || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const isDark = theme === 'dark';

  return (
    <div className="min-h-screen flex flex-col lg:flex-row relative overflow-hidden bg-slate-100 dark:bg-slate-950">
      {/* ========== LEFT: Branding / welcome panel (full height on desktop) ========== */}
      <div className="relative flex-1 min-h-[40vh] lg:min-h-screen flex flex-col justify-center px-8 sm:px-12 lg:px-16 py-12 lg:py-0">
        {/* Background layer */}
        <div className="absolute inset-0 bg-gradient-to-br from-red-600 via-red-700 to-slate-900 dark:from-red-900 dark:via-slate-900 dark:to-slate-950" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(255,255,255,0.15),transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_80%_50%,rgba(255,255,255,0.08),transparent)]" />

        {/* Animated grid / dots pattern */}
        <div
          className="absolute inset-0 opacity-[0.12] dark:opacity-[0.08]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, ${isDark ? '#fff' : '#000'} 1px, transparent 0)`,
            backgroundSize: '32px 32px',
          }}
        />

        {/* Large floating orbs */}
        <motion.div
          className="absolute top-1/4 -left-20 w-72 h-72 rounded-full bg-white/10 blur-3xl"
          animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          className="absolute bottom-1/4 -right-16 w-96 h-96 rounded-full bg-red-400/20 blur-3xl"
          animate={{ x: [0, -25, 0], y: [0, 15, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* Floating food icons — more and larger */}
        {['🍽️', '☕', '🥗', '🍕', '🥐', '🍰', '🥙', '🍜', '🥑', '🍩'].map((emoji, i) => (
          <motion.span
            key={i}
            className="absolute text-3xl sm:text-4xl lg:text-5xl opacity-20"
            style={{
              left: `${8 + (i * 9)}%`,
              top: `${10 + ((i * 13) % 75)}%`,
            }}
            animate={{
              y: [0, -25, 0],
              rotate: [0, 8, 0],
              scale: [1, 1.05, 1],
            }}
            transition={{
              duration: 5 + (i % 3),
              delay: i * 0.3,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          >
            {emoji}
          </motion.span>
        ))}

        {/* Content */}
        <div className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="flex items-center gap-4 mb-8"
          >
            <motion.img
              src="/foodies-logo.png"
              alt="Foodies"
              className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl object-contain bg-white/10 backdrop-blur-sm p-1.5 shadow-xl"
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="text-2xl sm:text-3xl font-bold text-white tracking-tight drop-shadow-sm">
              Foodies
            </span>
          </motion.div>

          <motion.h2
            className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white leading-tight max-w-md mb-4"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
          >
            Run your restaurant, your way.
          </motion.h2>
          <motion.p
            className="text-lg sm:text-xl text-white/85 max-w-sm mb-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
          >
            POS, orders, menu, and reports in one place.
          </motion.p>

          <ul className="space-y-4">
            {features.map((f) => (
              <motion.li
                key={f.text}
                className="flex items-center gap-3 text-white/90"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + f.delay, duration: 0.4 }}
              >
                <span className="text-2xl">{f.icon}</span>
                <span className="font-medium">{f.text}</span>
              </motion.li>
            ))}
          </ul>
        </div>
      </div>

      {/* ========== RIGHT: Form panel ========== */}
      <div className="relative flex-shrink-0 w-full lg:w-[48%] xl:w-[44%] min-h-[60vh] lg:min-h-screen flex flex-col justify-center items-center px-6 sm:px-10 lg:px-14 py-12 lg:py-16 bg-slate-50 dark:bg-slate-900/50">
        {/* Subtle background on form side */}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-200/50 to-transparent dark:from-slate-800/30 dark:to-transparent pointer-events-none" />
        <div
          className="absolute inset-0 opacity-[0.04] dark:opacity-[0.03] pointer-events-none"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, ${isDark ? '#94a3b8' : '#64748b'} 1px, transparent 0)`,
            backgroundSize: '24px 24px',
          }}
        />

        {/* Theme toggle */}
        <motion.button
          type="button"
          onClick={toggleTheme}
          className="absolute top-6 right-6 z-20 p-2.5 rounded-xl bg-white dark:bg-slate-800 shadow-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5 }}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </motion.button>

        {/* Form card — full width of column, no max-w so it uses the space */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 w-full max-w-md"
        >
          <motion.div
            className="bg-white dark:bg-slate-800/90 backdrop-blur-sm p-8 sm:p-10 rounded-2xl shadow-xl border border-slate-200/80 dark:border-slate-700/80"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
          >
            <div className="text-center mb-8">
              <motion.div
                className="inline-block mb-4"
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              >
                <img
                  src="/foodies-logo.png"
                  alt="Foodies"
                  className="h-16 w-16 sm:h-20 sm:w-20 mx-auto rounded-2xl object-contain"
                />
              </motion.div>
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100 mb-1">
                Welcome back
              </h1>
              <p className="text-gray-500 dark:text-slate-400 font-medium">
                Sign in to your admin account
              </p>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="p-4 mb-6 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-200 rounded-xl text-sm"
              >
                {error}
              </motion.div>
            )}

            <motion.form
              onSubmit={handleSubmit}
              className="space-y-5"
              variants={containerVariants}
              initial="hidden"
              animate="visible"
            >
              <motion.div variants={itemVariants}>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                  Email
                </label>
                <motion.input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3.5 rounded-xl border border-gray-200 dark:border-slate-600 bg-gray-50/80 dark:bg-slate-700/50 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-all"
                  placeholder="you@example.com"
                  whileFocus={{ scale: 1.01 }}
                  transition={{ type: 'tween', duration: 0.2 }}
                />
              </motion.div>

              <motion.div variants={itemVariants}>
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">
                  Password
                </label>
                <motion.input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3.5 rounded-xl border border-gray-200 dark:border-slate-600 bg-gray-50/80 dark:bg-slate-700/50 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-red-500/50 focus:border-red-500 transition-all"
                  placeholder="••••••••"
                  whileFocus={{ scale: 1.01 }}
                  transition={{ type: 'tween', duration: 0.2 }}
                />
              </motion.div>

              <motion.div variants={itemVariants} className="pt-2">
                <Button
                  type="submit"
                  variant="gradient"
                  disabled={loading}
                  isLoading={loading}
                  className="w-full py-4 rounded-xl text-base font-semibold shadow-lg hover:shadow-xl transition-shadow"
                  size="large"
                >
                  Login
                </Button>
              </motion.div>
            </motion.form>

            <p className="mt-6 text-center text-xs text-gray-400 dark:text-slate-500">
              Sign in to manage orders, menu, and reports.
            </p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default Login;
