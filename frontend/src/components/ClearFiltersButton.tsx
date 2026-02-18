import React from 'react';
import Button from './Button';

interface ClearFiltersButtonProps {
  onClick: () => void;
  label?: string;
}

/**
 * Consistent "Clear filters" button for filter bars across admin modules.
 */
const ClearFiltersButton: React.FC<ClearFiltersButtonProps> = ({
  onClick,
  label = 'Clear filters',
}) => (
  <Button type="button" variant="secondary" size="small" onClick={onClick}>
    {label}
  </Button>
);

export default ClearFiltersButton;
