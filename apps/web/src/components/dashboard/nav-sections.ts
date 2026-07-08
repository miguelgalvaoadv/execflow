import {
  primaryNavItems,
  settingsNavItem,
  teamNavItem,
  type NavItem,
} from "./nav-items";

export type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    id: "overview",
    label: "Visão geral",
    items: [primaryNavItems[0]],
  },
  {
    id: "operations",
    label: "Operações",
    items: primaryNavItems.slice(1),
  },
  {
    id: "system",
    label: "Sistema",
    // settingsNavItem NÃO entra aqui — já é fixado no rodapé via footerNavItem
    // (achado 08/07/2026: estava duplicado, "Configurações" aparecia 2x no menu).
    items: [teamNavItem],
  },
];

export const footerNavItem = settingsNavItem;
