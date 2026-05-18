import { Sidebar } from "./Sidebar";
import { borders, surfaces } from "./surfaces";

type DashboardLayoutProps = {
  children: React.ReactNode;
  activeItemId?: string;
};

export function DashboardLayout({
  children,
  activeItemId = "dashboard",
}: DashboardLayoutProps) {
  return (
    <div
      className={`h-screen overflow-hidden ${surfaces.canvas} font-sans antialiased text-zinc-100`}
    >
      <Sidebar activeItemId={activeItemId} />

      <div className="flex h-screen flex-col lg:pl-[260px]">
        <main className={`flex-1 overflow-y-auto pt-14 lg:pt-0 ${surfaces.main}`}>
          <div className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
            <div
              className={`rounded-2xl border ${borders.subtle} ${surfaces.panelMuted} p-4 sm:p-5 lg:p-6`}
            >
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
