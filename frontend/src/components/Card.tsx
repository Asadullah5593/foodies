import React from 'react';
import { motion } from 'framer-motion';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

const Card: React.FC<CardProps> = ({ 
  children, 
  className = '', 
  hover = false,
  onClick 
}) => {
  const baseStyles = 'bg-white dark:bg-slate-800 rounded-lg shadow-md border border-gray-200 dark:border-slate-700 p-4';
  const hoverStyles = hover ? 'cursor-pointer transition-shadow duration-200 hover:shadow-lg' : '';

  if (onClick) {
    return (
      <motion.div
        className={`${baseStyles} ${hoverStyles} ${className}`}
        onClick={onClick}
        whileHover={{ y: -2 }}
        whileTap={{ y: 0 }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <div className={`${baseStyles} ${className}`}>
      {children}
    </div>
  );
};

export default Card;
