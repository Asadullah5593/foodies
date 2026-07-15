import React from 'react';
import { motion } from 'framer-motion';
import Card from '../../../components/Card';

interface KpiCardProps {
  label: string;
  value: string;
  sublabel?: string;
  delta?: number | null;
  accent?: string; // tailwind text color class for the value
  index?: number;
  loading?: boolean;
}

const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  sublabel,
  delta,
  accent = 'text-gray-900 dark:text-slate-100',
  index = 0,
  loading = false,
}) => {
  if (loading) {
    return (
      <Card className="h-full">
        <div className="animate-pulse space-y-3">
          <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded" />
          <div className="h-7 w-28 bg-gray-200 dark:bg-slate-700 rounded" />
          <div className="h-3 w-16 bg-gray-200 dark:bg-slate-700 rounded" />
        </div>
      </Card>
    );
  }

  const hasDelta = delta != null && Number.isFinite(delta);
  const up = hasDelta && (delta as number) >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="h-full"
    >
      <Card className="h-full">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">
            {label}
          </h3>
          {hasDelta && (
            <span
              className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
                up
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
              title="vs previous period"
            >
              {up ? '▲' : '▼'} {Math.abs(delta as number).toFixed(1)}%
            </span>
          )}
        </div>
        <p className={`mt-2 text-2xl font-bold ${accent}`}>{value}</p>
        {/* Falls back to an nbsp — a plain space would collapse and lose the line */}
        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
          {sublabel ?? ' '}
        </p>
      </Card>
    </motion.div>
  );
};

export default KpiCard;
