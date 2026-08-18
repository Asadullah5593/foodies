import React from 'react';
import { Link } from 'react-router-dom';
import { MdTabletMac } from 'react-icons/md';
import AttendanceStations from './AttendanceStations';

/**
 * Attendance devices — the setup screen.
 *
 * Split out of the register because the two are different jobs on different
 * schedules: registering a tablet happens once, reading the register happens
 * every day. Having the registration form sit above the daily data put a setup
 * task in front of the thing people actually came to look at.
 */
const AttendanceDevices: React.FC = () => (
  <div className="p-4 md:p-6">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <MdTabletMac className="text-2xl text-gray-700 dark:text-gray-200" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Attendance devices
        </h1>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          to="/admin/hr/attendance"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
        >
          Attendance register
        </Link>
        <a
          href="/attendance"
          target="_blank"
          rel="noreferrer"
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Open attendance station
        </a>
      </div>
    </div>

    <p className="mb-5 text-sm text-gray-600 dark:text-gray-400">
      Register the tablet or terminal that staff clock in on. Open its setup link on that
      device once — after that the station works with nobody logged in, because the device
      carries its own token. That token records punches at its own branch and does nothing
      else, which is why it is readable here: replacing a broken tablet should not mean
      re-registering it.
    </p>

    <AttendanceStations />
  </div>
);

export default AttendanceDevices;
