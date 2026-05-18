import { DashboardLayout, DashboardWorkspace } from "@/components/dashboard";

export default function HomePage() {
  return (
    <DashboardLayout activeItemId="dashboard">
      <DashboardWorkspace />
    </DashboardLayout>
  );
}
