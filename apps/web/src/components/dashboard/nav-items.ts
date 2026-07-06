export type NavIcon =
  | "dashboard"
  | "executions"
  | "clients"
  | "deadlines"
  | "opportunities"
  | "documents"
  | "finance"
  | "settings"
  | "team"
  | "inventory"
  | "intimations"
  | "tasks";

export type NavItem = {
  id: string;
  label: string;
  icon: NavIcon;
  /** App Router href — matched against pathname for active state. */
  href: string;
  /**
   * Whether the route is fully implemented.
   * false = renders the page but marks it as stub in nav (no visual diff yet).
   */
  implemented?: boolean;
  pinned?: boolean;
};

export const primaryNavItems: NavItem[] = [
  { id: "dashboard", label: "Início", icon: "dashboard", href: "/dashboard", implemented: true },
  { id: "executions", label: "Execuções", icon: "executions", href: "/cases", implemented: true },
  { id: "inventory", label: "Inventário OAB", icon: "inventory", href: "/inventory", implemented: true },
  { id: "intimations", label: "Intimações", icon: "intimations", href: "/intimations", implemented: true },
  { id: "clients", label: "Clientes", icon: "clients", href: "/clients", implemented: true },
  { id: "deadlines", label: "Prazos", icon: "deadlines", href: "/deadlines", implemented: true },
  { id: "opportunities", label: "Oportunidades", icon: "opportunities", href: "/opportunities", implemented: true },
  { id: "tasks", label: "Tarefas", icon: "tasks", href: "/tasks", implemented: true },
  { id: "documents", label: "Peças", icon: "documents", href: "/documents", implemented: true },
  { id: "finance", label: "Financeiro", icon: "finance", href: "/finance", implemented: false },
];

export const settingsNavItem: NavItem = {
  id: "settings",
  label: "Configurações",
  icon: "settings",
  href: "/settings",
  implemented: true,
  pinned: true,
};

export const teamNavItem: NavItem = {
  id: "team",
  label: "Equipe",
  icon: "team",
  href: "/team",
  implemented: true,
  pinned: true,
};
