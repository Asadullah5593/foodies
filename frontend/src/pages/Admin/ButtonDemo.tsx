import React from 'react';
import Button from '../../components/Button';
import Card from '../../components/Card';

const ButtonDemo: React.FC = () => {
  const base =
    'font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 inline-flex items-center gap-2';

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-10">
      <div>
        <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100 mb-2">Button styles</h1>
        <p className="text-gray-600 dark:text-slate-400">
          <strong>Light theme</strong> = Option C (subtle/minimal). <strong>Dark theme</strong> = Option D (dark/charcoal).
          Checkout, Create Order, and Logout always use the <strong>gradient</strong> style.
        </p>
      </div>

      <Card className="p-6">
        <h2 className="text-xl font-semibold text-gray-800 dark:text-slate-100 mb-4">Current (theme-based)</h2>
        <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
          Light = Option C. Dark = Option D. Toggle theme to see them change.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="success">Success</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="view">View</Button>
          <Button variant="edit">Edit</Button>
        </div>
        <div className="flex flex-wrap gap-3 mt-3">
          <Button variant="gradient">Checkout / Create Order / Logout</Button>
          <Button size="small" variant="primary">Small</Button>
          <Button size="large" variant="primary">Large</Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Option B — Soft solid (no gradient)</h2>
        <p className="text-sm text-gray-600 mb-4">
          Solid red primary, slate secondary. Clean and flat.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={`${base} bg-red-600 text-white hover:bg-red-700 px-4 py-2 rounded-lg`}>Primary</button>
          <button type="button" className={`${base} bg-slate-600 text-white hover:bg-slate-700 px-4 py-2 rounded-lg`}>Secondary</button>
          <button type="button" className={`${base} border-2 border-gray-300 text-gray-700 hover:bg-gray-100 px-4 py-2 rounded-lg bg-transparent`}>Outline</button>
          <button type="button" className={`${base} bg-red-600 text-white hover:bg-red-700 px-4 py-2 rounded-lg`}>Danger</button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Option C — Subtle / minimal</h2>
        <p className="text-sm text-gray-600 mb-4">
          Light red/slate backgrounds, colored text. Low contrast, soft.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={`${base} bg-red-50 text-red-700 hover:bg-red-100 px-4 py-2 rounded-lg border border-red-200`}>Primary</button>
          <button type="button" className={`${base} bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 rounded-lg`}>Secondary</button>
          <button type="button" className={`${base} bg-red-50 text-red-700 hover:bg-red-100 px-4 py-2 rounded-lg border border-red-300`}>Danger</button>
          <button type="button" className={`${base} border border-gray-300 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg bg-white`}>Outline</button>
        </div>
      </Card>

      <Card className="p-6 bg-slate-800">
        <h2 className="text-xl font-semibold text-white mb-4">Option D — Dark / charcoal</h2>
        <p className="text-sm text-slate-300 mb-4">
          Dark backgrounds, white text. Premium feel.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={`${base} bg-slate-700 text-white hover:bg-slate-600 px-4 py-2 rounded-lg border border-slate-600`}>Primary</button>
          <button type="button" className={`${base} bg-red-900 text-white hover:bg-red-800 px-4 py-2 rounded-lg border border-red-800`}>Danger</button>
          <button type="button" className={`${base} border border-slate-500 text-slate-200 hover:bg-slate-700 px-4 py-2 rounded-lg bg-transparent`}>Outline</button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Option E — Softer gradient</h2>
        <p className="text-sm text-gray-600 mb-4">
          Red-only gradient (no black). Lighter option.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={`${base} text-white px-4 py-2 rounded-lg !bg-[linear-gradient(90deg,#DC2626,#B91C1C,#991B1B)] hover:brightness-110`}>Primary</button>
          <button type="button" className={`${base} bg-red-600 text-white hover:bg-red-700 px-4 py-2 rounded-lg`}>Danger</button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Option F — Pill shape (current colors)</h2>
        <p className="text-sm text-gray-600 mb-4">
          Same gradient/semantic colors, rounded-full pill shape.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={`${base} rounded-full text-white px-5 py-2 !bg-[linear-gradient(90deg,#000,#B91C1C,#000)] hover:brightness-110`}>Primary</button>
          <button type="button" className={`${base} rounded-full border-2 border-gray-300 text-gray-700 px-5 py-2 bg-transparent`}>Outline</button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Option G — Outlined primary</h2>
        <p className="text-sm text-gray-600 mb-4">
          No fill on primary; red border and text, hover light fill.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={`${base} border-2 border-red-600 text-red-600 hover:bg-red-50 focus:ring-red-400 px-4 py-2 rounded-lg bg-transparent`}>Primary</button>
          <button type="button" className={`${base} border-2 border-slate-500 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded-lg bg-transparent`}>Secondary</button>
          <button type="button" className={`${base} border-2 border-red-600 text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg bg-transparent`}>Danger</button>
          <button type="button" className={`${base} border border-gray-300 text-gray-600 hover:bg-gray-50 px-4 py-2 rounded-lg bg-white`}>Outline</button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Semantic actions (View / Edit / Delete)</h2>
        <p className="text-sm text-gray-600 mb-4">
          How View, Edit, and Delete look in tables and cards (current Option A).
        </p>
        <div className="flex flex-wrap gap-3">
          <Button size="small" variant="view">View</Button>
          <Button size="small" variant="edit">Edit</Button>
          <Button size="small" variant="danger">Delete</Button>
          <Button size="small" variant="outline">Cancel</Button>
        </div>
      </Card>
    </div>
  );
};

export default ButtonDemo;