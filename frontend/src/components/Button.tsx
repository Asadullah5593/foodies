import React from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '../contexts/ThemeContext';

/** Gradient for Checkout, Create Order, Logout (always this style) */
export const BUTTON_GRADIENT =
  'text-white border-0 !bg-[linear-gradient(90deg,#000000_0%,#B91C1C_50%,#000000_100%)] hover:brightness-110 active:brightness-95 focus:ring-red-600/50';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'success'
  | 'outline'
  | 'view'
  | 'edit'
  | 'gradient';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'small' | 'medium' | 'large';
  isLoading?: boolean;
  children: React.ReactNode;
}

/** Option C — Light theme: subtle / minimal */
const variantLight: Record<Exclude<ButtonVariant, 'gradient'>, string> = {
  primary: 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 focus:ring-2 focus:ring-red-300 focus:ring-offset-2',
  secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-0 focus:ring-2 focus:ring-slate-400 focus:ring-offset-2',
  success: 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 focus:ring-2 focus:ring-red-300 focus:ring-offset-2',
  danger: 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-300 focus:ring-2 focus:ring-red-400 focus:ring-offset-2',
  outline: 'border border-gray-300 text-gray-600 hover:bg-gray-50 focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 bg-white',
  view: 'border border-gray-300 text-gray-700 hover:bg-gray-50 focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 bg-white',
  edit: 'border-2 border-slate-500 text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 bg-white',
};

/** Option D — Dark theme: dark / charcoal */
const variantDark: Record<Exclude<ButtonVariant, 'gradient'>, string> = {
  primary: 'bg-slate-700 text-white hover:bg-slate-600 border border-slate-600 focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900',
  secondary: 'bg-slate-600 text-white hover:bg-slate-500 border-0 focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900',
  success: 'bg-slate-700 text-white hover:bg-slate-600 border border-slate-600 focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900',
  danger: 'bg-red-900 text-white hover:bg-red-800 border border-red-800 focus:ring-2 focus:ring-red-700 focus:ring-offset-2 focus:ring-offset-slate-900',
  outline: 'border border-slate-500 text-slate-200 hover:bg-slate-700 bg-transparent focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900',
  view: 'border border-slate-500 text-slate-200 hover:bg-slate-700 bg-transparent focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900',
  edit: 'border-2 border-slate-400 text-slate-200 hover:bg-slate-700 bg-transparent focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-900',
};

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'medium',
  isLoading = false,
  children,
  className = '',
  disabled,
  onDrag,
  onDragStart,
  onDragEnd,
  ...props
}) => {
  const { theme } = useTheme();
  const baseStyles =
    'font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed';

  const isGradient = variant === 'gradient';
  const semanticVariant = isGradient ? 'primary' : variant;
  const variantStyles = theme === 'dark' ? variantDark[semanticVariant] : variantLight[semanticVariant];
  const resolvedStyles = isGradient ? BUTTON_GRADIENT : variantStyles;

  const sizeStyles = {
    small: 'px-3 py-1.5 text-sm',
    medium: 'px-4 py-2 text-base',
    large: 'px-6 py-3 text-lg',
  };

  return (
    <motion.button
      className={`${baseStyles} ${resolvedStyles} ${sizeStyles[size]} ${className}`}
      disabled={disabled || isLoading}
      whileHover={{ scale: disabled || isLoading ? 1 : 1.02 }}
      whileTap={{ scale: disabled || isLoading ? 1 : 0.98 }}
      {...(props as Record<string, unknown>)}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <motion.div
            className={`w-4 h-4 border-2 border-t-transparent rounded-full ${isGradient ? 'border-white' : 'border-current'}`}
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
          Loading...
        </span>
      ) : (
        children
      )}
    </motion.button>
  );
};

export default Button;
