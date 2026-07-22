import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { LoginPage } from '../features/auth/LoginPage'
import { AuthProvider, RequireAuth } from './auth'

function renderApp(initialPath: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <h1>Protected area</h1>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

/* Runs with VITE_USE_MOCKS=true (see vite.config.ts), so sign-in takes the
 * offline path rather than calling the API. Real credential verification and
 * the admin-role check are covered by the backend's own tests. */
describe('auth', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('redirects unauthenticated visitors to the login page', () => {
    renderApp('/')
    expect(screen.getByRole('heading', { name: 'Internal sign in' })).toBeInTheDocument()
  })

  it('signs in and reaches the protected area', async () => {
    renderApp('/login')
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'leon@bauhly.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enter backoffice' }))

    // Sign-in is async now, so the protected area appears on a later tick.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Protected area' })).toBeInTheDocument(),
    )
  })

  it('shows a validation error when fields are empty', () => {
    renderApp('/login')
    fireEvent.click(screen.getByRole('button', { name: 'Enter backoffice' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your email and password')
  })
})
