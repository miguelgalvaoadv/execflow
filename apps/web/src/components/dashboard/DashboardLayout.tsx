import { Sidebar } from "./Sidebar";
import { surfaces } from "./surfaces";

type DashboardLayoutProps = {
  children: React.ReactNode;
};

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div
      className={`h-screen overflow-hidden ${surfaces.canvas} font-sans antialiased text-slate-900`}
    >
      <Sidebar />

      <div className="flex h-screen flex-col lg:pl-64 dashboard-layout-content">
        <main className={`flex-1 overflow-y-auto pt-14 lg:pt-0 ${surfaces.main}`}>
          <div className="mx-auto w-full max-w-[1280px] px-5 py-6 sm:px-7 lg:px-10 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
