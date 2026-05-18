import {
  primaryNavItems,
  settingsNavItem,
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
];

export const footerNavItem = settingsNavItem;
