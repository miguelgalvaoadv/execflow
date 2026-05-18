import type { NavIcon as NavIconName } from "./nav-items";

type NavIconProps = {
  name: NavIconName;
  className?: string;
};

export function NavIcon({ name, className = "h-[18px] w-[18px]" }: NavIconProps) {
  const stroke = "currentColor";

  switch (name) {
    case "dashboard":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="3" width="8" height="8" rx="1.5" stroke={stroke} strokeWidth="1.5" />
          <rect x="13" y="3" width="8" height="8" rx="1.5" stroke={stroke} strokeWidth="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" stroke={stroke} strokeWidth="1.5" />
          <rect x="13" y="13" width="8" height="8" rx="1.5" stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    case "executions":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M8 5v14l11-7L8 5z"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "clients":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="9" cy="8" r="3" stroke={stroke} strokeWidth="1.5" />
          <path
            d="M3.5 19c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M16 11.5c1.38 0 2.5 1.12 2.5 2.5V19"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="17" cy="8" r="2.5" stroke={stroke} strokeWidth="1.5" />
        </svg>
      );
    case "deadlines":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="4" y="5" width="16" height="15" rx="2" stroke={stroke} strokeWidth="1.5" />
          <path d="M8 3v4M16 3v4M4 10h16" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "opportunities":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 3l2.2 6.8H21l-5.6 4.1 2.2 6.8L12 16.6 6.4 20.7l2.2-6.8L3 9.8h6.8L12 3z"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "documents":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M8 4h8l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M16 4v4h4M9 13h6M9 17h4" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "finance":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3" y="6" width="18" height="13" rx="2" stroke={stroke} strokeWidth="1.5" />
          <path d="M3 10h18M7 14h4" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case "settings":
      return (
        <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="3" stroke={stroke} strokeWidth="1.5" />
          <path
            d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    default:
      return null;
  }
}
