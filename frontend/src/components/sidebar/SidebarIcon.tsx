"use client";

import type { LucideIcon } from "lucide-react";

interface SidebarIconProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}

export default function SidebarIcon({ icon: Icon, label, active, onClick, badge }: SidebarIconProps) {
  return (
    <div className="group relative flex items-center justify-center">
      <button
        onClick={onClick}
        aria-label={label}
        className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${
          active
            ? "bg-zinc-800 text-white shadow-sm"
            : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
        }`}
      >
        <Icon size={19} strokeWidth={active ? 2.2 : 1.8} />
        {typeof badge === "number" && badge > 0 && (
          <span className="absolute -right-0 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-zinc-700 px-1 text-[9px] font-semibold text-zinc-300">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
      {/* Tooltip */}
      <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 opacity-0 shadow-xl transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 -translate-x-1">
        {label}
      </span>
    </div>
  );
}
