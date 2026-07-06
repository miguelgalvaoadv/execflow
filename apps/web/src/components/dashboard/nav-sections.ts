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
    items: [teamNavItem, settingsNavItem],
  },
];

export const footerNavItem = settingsNavItem;
