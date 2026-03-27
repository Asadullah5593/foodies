import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

test('renders Login feature text', async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );

  // App redirects unauthenticated users to /login; wait for a login-specific string.
  expect(await screen.findByText(/Orders & POS/i)).toBeInTheDocument();
});
