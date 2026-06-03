import React from 'react';
import Card from '../../../components/Card';

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
    <Card className={`p-0 overflow-hidden flex flex-col ${className}`}>
      <div className="flex items-start justify-between gap-3 p-4 border-b border-gray-100 dark:border-slate-700">
        <div>
          <h3 className="text-base font-semibold text-gray-800 dark:text-slate-100">{title}</h3>
          {subtitle && (
            <p className="text-xs text-gray-500 dark:text-slate-400">{subtitle}</p>
          )}
        </div>
        {right}
      </div>
      <div className={`p-4 flex-1 ${bodyClassName}`}>
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
    </Card>
  );
};

export default ChartCard;
