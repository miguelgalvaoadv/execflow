export type NavIcon =
  | "dashboard"
  | "executions"
  | "clients"
  | "deadlines"
  | "opportunities"
  | "documents"
  | "finance"
  | "settings";

export type NavItem = {
  id: string;
  label: string;
  icon: NavIcon;
  pinned?: boolean;
};

export const primaryNavItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "executions", label: "Execuções", icon: "executions" },
  { id: "clients", label: "Clientes", icon: "clients" },
  { id: "deadlines", label: "Prazos", icon: "deadlines" },
  { id: "opportunities", label: "Oportunidades", icon: "opportunities" },
  { id: "documents", label: "Peças", icon: "documents" },
  { id: "finance", label: "Financeiro", icon: "finance" },
];

export const settingsNavItem: NavItem = {
  id: "settings",
  label: "Configurações",
  icon: "settings",
  pinned: true,
};
