import { Sidebar } from "./Sidebar";
import { surfaces, text } from "./surfaces";

type DashboardLayoutProps = {
  children: React.ReactNode;
};

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div
      className={`h-screen w-full overflow-hidden ${surfaces.canvas} font-sans antialiased ${text.primary}`}
    >
      <div className="flex h-screen flex-col lg:flex-row w-full min-w-0">
        <Sidebar />

        <main className={`dashboard-layout-content flex-1 overflow-y-auto pt-14 lg:pt-0 ${surfaces.main} w-full min-w-0`}>
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 xl:px-12 lg:py-8 min-w-0">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
