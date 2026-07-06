import {
  LayoutDashboard,
  Gavel,
  Users,
  CalendarClock,
  Lightbulb,
  FileText,
  Wallet,
  Settings,
  UsersRound,
  ListChecks,
  BellRing,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
import type { NavIcon as NavIconName } from "./nav-items";

const ICONS: Record<NavIconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  executions: Gavel,
  clients: Users,
  deadlines: CalendarClock,
  opportunities: Lightbulb,
  documents: FileText,
  finance: Wallet,
  settings: Settings,
  team: UsersRound,
  inventory: ListChecks,
  intimations: BellRing,
  tasks: ClipboardCheck,
};

type NavIconProps = {
  name: NavIconName;
  className?: string;
};

export function NavIcon({ name, className = "h-[18px] w-[18px]" }: NavIconProps) {
  const Icon = ICONS[name];
  if (Icon === undefined) return null;
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}
