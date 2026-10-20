import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { createQueryClient } from '../shared/api/query-client';
import { StatePanel } from '../shared/ui/StatePanel';
import { SessionProvider } from '../features/auth/SessionProvider';
import { AuthPage } from '../features/auth/AuthPage';
import { PrivateAccountPage } from '../accounts/private/PrivateAccountPage';
import { CatalogPage } from '../features/events/catalog/CatalogPage';
import { HomePage } from '../home/HomePage';
import { EventPage } from '../features/events/detail/EventPage';
import { PublicAccountPage } from '../accounts/public/PublicAccountPage';
import { PublicOrganizationPage } from '../organizations/public/PublicOrganizationPage';
import { CreateEventPage } from '../features/events/create/CreateEventPage';
import { EventDraftSessionBoundary } from '../features/events/create/draft';
import { OrganizationDraftSessionBoundary } from '../features/organizations/create/draft';
import { AppShell } from './AppShell';
import { NotFoundPage, RouteErrorPage, ScreenPlaceholder } from './ScreenPlaceholder';
import { screenRoutes } from './routes';

export const queryClient = createQueryClient();
const router = createBrowserRouter([{
  element: <AppShell />,
  hydrateFallbackElement: <StatePanel kind="loading" title="Открываем страницу" />,
  errorElement: <RouteErrorPage />,
  children: [
    ...screenRoutes.map((route) => {
      if (route.path === '/admin/organizations') return { path: route.path, lazy: async () => ({ Component: (await import('../features/admin/organizations/OrganizationListPage')).OrganizationListPage }) };
      if (route.path === '/admin/organizations/:organizationId') return { path: route.path, lazy: async () => ({ Component: (await import('../features/admin/organizations/OrganizationReviewPage')).OrganizationReviewPage }) };
      if (route.path === '/organizations/new') return { path: route.path, lazy: async () => ({ Component: (await import('../features/organizations/create/CreateOrganizationPage')).CreateOrganizationPage }) };
      if (route.path === '/me/organizations') return { path: route.path, lazy: async () => ({ Component: (await import('../features/organizations/private/MyOrganizationsPage')).MyOrganizationsPage }) };
      if (route.path === '/me/organizations/:organizationId') return { path: route.path, lazy: async () => ({ Component: (await import('../features/organizations/private/OrganizationCabinetPage')).OrganizationCabinetPage }) };
      return { path: route.path, element:
      route.path === '/' ? <HomePage />
        : route.path === '/events' ? <CatalogPage />
        : route.path === '/events/new' ? <CreateEventPage />
        : route.path === '/events/:eventId' ? <EventPage />
        : route.path === '/people/:accountId' ? <PublicAccountPage />
        : route.path === '/organizations/:organizationId' ? <PublicOrganizationPage />
        : route.path === '/login' ? <AuthPage mode="login" />
        : route.path === '/register' ? <AuthPage mode="register" />
          : route.path === '/me' ? <PrivateAccountPage />
            : <ScreenPlaceholder route={route} /> };
    }),
    ...(import.meta.env.DEV ? [{
      path: '/dev/ui',
      lazy: async () => ({ Component: (await import('./ComponentGallery')).ComponentGallery }),
    }] : []),
    { path: '*', element: <NotFoundPage /> },
  ],
}]);

export function App() {
  return <QueryClientProvider client={queryClient}><SessionProvider><EventDraftSessionBoundary /><OrganizationDraftSessionBoundary /><RouterProvider router={router} /></SessionProvider></QueryClientProvider>;
}
