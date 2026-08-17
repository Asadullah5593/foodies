import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster, ToastBar, toast } from 'react-hot-toast'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  // Removed StrictMode to prevent double renders in development that cause concurrent API requests
  <QueryClientProvider client={queryClient}>
    <App />
    <Toaster 
      position="top-right"
      toastOptions={{
        duration: 3000,
        style: {
          background: '#363636',
          color: '#fff',
        },
        success: {
          duration: 3000,
          iconTheme: {
            primary: '#28a745',
            secondary: '#fff',
          },
        },
        error: {
          duration: 4000,
          iconTheme: {
            primary: '#dc3545',
            secondary: '#fff',
          },
        },
      }}
    >
      {/* Click anywhere on a toast to dismiss it. Long error messages sit on
          screen for seconds and cover the page; tapping them is the obvious
          thing to try, so it should work. */}
      {(t) => (
        <div
          onClick={() => toast.dismiss(t.id)}
          style={{ cursor: 'pointer' }}
          role="button"
          tabIndex={-1}
        >
          <ToastBar toast={t} />
        </div>
      )}
    </Toaster>
  </QueryClientProvider>,
)
