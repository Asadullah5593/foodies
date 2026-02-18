import axios from 'axios';

// Use environment variable or default to NestJS backend
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  withCredentials: false, // Token-based auth doesn't need cookies
});

// Request interceptor to add auth token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 403) {
      // Do NOT redirect on 403 – user is logged in but lacks permission; let the caller show a message
      return Promise.reject(error);
    }
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    // Handle connection errors gracefully
    if (
      error.code === 'ERR_NETWORK' || 
      error.code === 'ERR_CONNECTION_REFUSED' ||
      error.code === 'ERR_EMPTY_RESPONSE' ||
      error.code === 'ERR_CONNECTION_RESET'
    ) {
      console.error('API connection error. Make sure the backend server is running (e.g. http://127.0.0.1:3001).');
      // Don't throw for connection errors - return a structured error instead
      return Promise.reject({
        ...error,
        isConnectionError: true,
        message: 'Cannot connect to backend server. Please ensure the NestJS server is running.'
      });
    }
    return Promise.reject(error);
  }
);

export default apiClient;
