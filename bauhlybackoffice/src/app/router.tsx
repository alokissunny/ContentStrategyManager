import { createBrowserRouter } from 'react-router-dom'
import { LoginPage } from '../features/auth/LoginPage'
import { CompetitorsSection, CustomersPage } from '../features/pages'
import { RequireAuth } from './auth'
import { AppShell } from './shell/AppShell'
import { EmptyState } from '../components/EmptyState'

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <CompetitorsSection /> },
      { path: 'competitors-overview', element: <CompetitorsSection /> },
      { path: 'competitors', element: <CompetitorsSection /> },
      { path: 'customers', element: <CustomersPage /> },
      {
        path: '*',
        element: (
          <EmptyState
            title="Page not found"
            description="This page doesn't exist. Use the navigation to get back on track."
          />
        ),
      },
    ],
  },
])
