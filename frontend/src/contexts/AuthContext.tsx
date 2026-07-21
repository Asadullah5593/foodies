import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';
import { authService } from '../services/api/authService';
import { normalizePakistaniPhone } from '../utils/phone';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  /** `identifier` is an email (staff) or a Pakistani mobile number (riders). */
  login: (identifier: string, password: string) => Promise<User | null>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      setLoading(false);
      return;
    }
    
    // Use ref to prevent duplicate requests
    let cancelled = false;
    let requestAbortController: AbortController | null = null;
    
    const fetchUser = async () => {
      // Cancel any previous request
      if (requestAbortController) {
        requestAbortController.abort();
      }
      
      requestAbortController = new AbortController();
      
      try {
        const userData = await authService.getCurrentUser();
        if (!cancelled) {
          setUser(userData);
        }
      } catch (error: any) {
        if (cancelled || error.name === 'AbortError') {
          return;
        }
        
        // Only clear token on 401 (unauthorized), not on connection errors
        if (error.response?.status === 401) {
          localStorage.removeItem('auth_token');
        }
        // For connection errors, keep the token but don't set user
        if (error.isConnectionError) {
          console.warn('Backend unavailable, but keeping session token');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    
    fetchUser();
    
    // Cleanup - cancel request if component unmounts
    return () => {
      cancelled = true;
      if (requestAbortController) {
        requestAbortController.abort();
      }
    };
  }, []);

  /**
   * `identifier` is whatever was typed into the single credential field: a
   * Pakistani mobile number is sent as `phone` (how riders sign in), anything
   * else as `email` (office staff). The backend rejects a rider who presents
   * an email, so the two are not interchangeable.
   */
  const login = async (identifier: string, password: string): Promise<User | null> => {
    const phone = normalizePakistaniPhone(identifier);
    const response = await authService.login(
      phone ? { phone, password } : { email: identifier.trim(), password },
    );
    // Refetch user from API so we have the same shape as after refresh (tenant_id, is_super_admin, etc.)
    try {
      const userData = await authService.getCurrentUser();
      setUser(userData);
      return userData;
    } catch (e) {
      setUser(response.user);
      return response.user;
    }
  };

  const logout = async () => {
    await authService.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated: !!user,
      login,
      logout,
      loading,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
