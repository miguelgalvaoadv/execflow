"use client";

import { useState } from "react";
import { SidebarBrand } from "./SidebarBrand";
import { SidebarNavItem } from "./SidebarNavItem";
import { footerNavItem, navSections } from "./nav-sections";
import { borders, surfaces, text } from "./surfaces";

type SidebarProps = Record<string, never>;

function SidebarPanel({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className={`border-b ${borders.subtle} px-5 py-5`}>
        <SidebarBrand />
      </div>

      <nav
        className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 py-5"
        aria-label="Navegação principal"
      >
        {navSections.map((section) => (
          <div key={section.id}>
            <p
              className={`mb-2 px-2.5 text-[10px] font-medium uppercase tracking-[0.16em] ${text.faint}`}
            >
              {section.label}
            </p>
            <ul className="space-y-1">
              {section.items.map((item) => (
                <li key={item.id}>
                  <SidebarNavItem
                    item={item}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className={`mt-auto shrink-0 border-t ${borders.subtle} pt-4`}>
          <p
            className={`mb-2 px-2.5 text-[10px] font-medium uppercase tracking-[0.16em] ${text.faint}`}
          >
            Sistema
          </p>
          <ul>
            <li>
              <SidebarNavItem
                item={footerNavItem}
                onNavigate={onNavigate}
              />
            </li>
          </ul>
        </div>
      </nav>
    </div>
  );
}

export function Sidebar(_props: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b ${borders.subtle} ${surfaces.sidebar}/95 px-4 backdrop-blur-md lg:hidden`}
      >
        <SidebarBrand compact />
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-[10px] border ${borders.default} bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-900`}
          aria-label="Abrir menu"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 7h16M4 12h16M4 17h16"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] lg:hidden"
          aria-label="Fechar menu"
          onClick={closeMobile}
        />
      ) : null}

      <aside
        className={[
          `fixed top-0 left-0 z-50 h-screen w-64 ${surfaces.sidebar} shadow-xl`,
          "lg:translate-x-0 transition-transform duration-200 ease-in-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div
          className={`flex h-14 items-center justify-end border-b ${borders.subtle} px-3 lg:hidden`}
        >
          <button
            type="button"
            onClick={closeMobile}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Fechar menu"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="h-[calc(100%-3.5rem)] lg:h-full">
          <SidebarPanel onNavigate={closeMobile} />
        </div>
      </aside>
    </>
  );
}
