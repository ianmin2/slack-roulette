import type { Metadata } from 'next';
import { Sidebar } from '@/app/dashboard/components/Sidebar';
import { Header } from '@/app/dashboard/components/Header';

export const metadata: Metadata = {
  title: 'PR Roulette Dashboard',
};

const DashboardLayout = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <div className="flex h-screen overflow-hidden bg-gray-50">
    {/* Sidebar */}
    <Sidebar />

    {/* Main content area */}
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <Header />

      {/* Page content */}
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
    </div>
  </div>
);

export default DashboardLayout;
