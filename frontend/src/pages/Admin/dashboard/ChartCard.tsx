import React from 'react';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  loading?: boolean;
  isEmpty?: boolean;
  emptyText?: string;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  right,
  loading = false,
  isEmpty = false,
  emptyText = 'No data for this range — try widening the dates.',
  className = '',
  bodyClassName = '',
  children,
}) => {
  return (
    <div
      className={`flex flex-col rounded-2xl border border-gray-200 bg-white px-[22px] py-5 shadow-[0_6px_18px_rgba(15,23,42,0.04)] dark:border-slate-700 dark:bg-slate-800 ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15.5px] font-bold text-gray-800 dark:text-slate-100">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-[12.5px] text-gray-500 dark:text-slate-400">{subtitle}</p>
          )}
        </div>
        {right}
      </div>
      <div className={`mt-4 flex-1 ${bodyClassName}`}>
        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-1/3 bg-gray-200 dark:bg-slate-700 rounded" />
            <div className="h-40 bg-gray-200 dark:bg-slate-700 rounded" />
          </div>
        ) : isEmpty ? (
          <div className="flex h-40 items-center justify-center text-center text-sm text-gray-400 dark:text-slate-500">
            {emptyText}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
};

export default ChartCard;
