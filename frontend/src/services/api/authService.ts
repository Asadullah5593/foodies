import apiClient from '../../utils/apiClient';
import { User } from '../../types';

export interface LoginCredentials {
  /** Office staff credential. */
  email?: string;
  /** Rider credential — riders sign in with their mobile number, not email. */
  phone?: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  token: string;
}

export const authService = {
  login: async (credentials: LoginCredentials): Promise<LoginResponse> => {
    const response = await apiClient.post<LoginResponse>('/auth/login', credentials);
    if (response.data.token) {
      localStorage.setItem('auth_token', response.data.token);
    }
    return response.data;
  },

  logout: async (): Promise<void> => {
    try {
      await apiClient.post('/auth/logout');
    } catch (error) {
      // Continue with logout even if API call fails
      console.error('Logout API error:', error);
    } finally {
      localStorage.removeItem('auth_token');
    }
  },

  getCurrentUser: async (): Promise<User> => {
    const response = await apiClient.get<User>('/auth/user');
    return response.data;
  },
};
