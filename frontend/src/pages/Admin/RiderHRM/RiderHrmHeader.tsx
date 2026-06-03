import React from 'react';
import { Link } from 'react-router-dom';
import Button from '../../../components/Button';

type RiderHrmHeaderProps = {
  title: string;
  subtitle?: string;
};

/** Consistent header for every Rider HRM submodule page. */
const RiderHrmHeader: React.FC<RiderHrmHeaderProps> = ({ title, subtitle }) => (
  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">
        {title}
      </h1>
      {subtitle ? (
        <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{subtitle}</p>
      ) : null}
    </div>
    <div className="flex flex-wrap gap-2">
      <Link to="/admin/orders">
        <Button variant="outline">Go to Orders</Button>
      </Link>
      <Link to="/admin/branches">
        <Button variant="outline">Configure Branches</Button>
      </Link>
    </div>
  </div>
);

export default RiderHrmHeader;
