import React from 'react';
import Inventory from './Inventory';

const InventoryAdjustments: React.FC = () => {
  return <Inventory initialTab="adjustments" showTabs={false} />;
};

export default InventoryAdjustments;
