import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../contexts/AuthContext';
import Card from '../../components/Card';

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const quickActions = [
    { path: '/admin/tenants', title: 'Tenants', description: 'Manage restaurant groups', icon: '🏢', color: 'blue' },
    { path: '/admin/brands', title: 'Brands', description: 'Manage brands', icon: '🏪', color: 'purple' },
    { path: '/admin/branches', title: 'Branches', description: 'Manage branches', icon: '📍', color: 'green' },
    { path: '/admin/users', title: 'Users', description: 'Manage users', icon: '👥', color: 'indigo' },
    { path: '/admin/menu-items', title: 'Menu Items', description: 'Manage menu items', icon: '🍽️', color: 'orange' },
    { path: '/admin/discounts', title: 'Discounts', description: 'Manage discounts', icon: '🎫', color: 'pink' },
    { path: '/admin/shifts', title: 'Shifts', description: 'Manage shifts', icon: '⏰', color: 'yellow' },
    { path: '/admin/reports', title: 'Reports', description: 'View reports', icon: '📈', color: 'teal' },
    { path: '/pos/orders', title: 'POS', description: 'Point of Sale', icon: '🛒', color: 'red' },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-4xl font-bold text-gray-800 mb-2">Admin Dashboard</h1>
        <p className="text-xl text-gray-600">Welcome back, <span className="font-semibold text-blue-600">{user?.name}</span>!</p>
      </motion.div>

      <div>
        <h2 className="text-2xl font-semibold text-gray-800 mb-6">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {quickActions.map((action, index) => (
            <motion.div
              key={action.path}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card
                hover
                onClick={() => navigate(action.path)}
                className="h-full"
              >
                <div className="flex items-start gap-4">
                  <div className={`text-4xl p-3 rounded-lg bg-${action.color}-100`}>
                    {action.icon}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-semibold text-gray-800 mb-1">{action.title}</h3>
                    <p className="text-gray-600 text-sm">{action.description}</p>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
