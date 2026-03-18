import React from 'react';
import { motion } from 'framer-motion';

interface LoaderProps {
  size?: 'small' | 'medium' | 'large';
  text?: string;
  fullScreen?: boolean;
}

const Loader: React.FC<LoaderProps> = ({
  size = 'medium',
  text,
  fullScreen = false,
}) => {
  const sizeMap = {
    small: 'w-4 h-4',
    medium: 'w-8 h-8',
    large: 'w-12 h-12',
  };

  const containerClass = fullScreen
    ? 'fixed inset-0 flex items-center justify-center bg-white/80 dark:bg-slate-900/80 z-50 backdrop-blur-sm'
    : 'flex items-center justify-center p-4';

  return (
    <div className={containerClass} role="status" aria-live="polite" aria-label={text ?? 'Loading'}>
      <div className="flex flex-col items-center gap-3">
        <motion.div
          className={`${sizeMap[size]} border-4 border-blue-200 border-t-blue-600 dark:border-slate-600 dark:border-t-blue-400 rounded-full`}
          animate={{ rotate: 360 }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
        {text && (
          <motion.p
            className="text-gray-600 dark:text-slate-300 text-sm font-medium"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            {text}
          </motion.p>
        )}
      </div>
    </div>
  );
};

export default Loader;
