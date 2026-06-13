"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Users,
  Shield,
  Settings,
  Menu,
  X,
  Goal,
} from "lucide-react";
import { CrestSlot } from "@/components/football/crest-slot";
import { useState } from "react";

interface NavItem {
  name: string;
  href: string;
  icon: typeof Home;
}

const navItems: NavItem[] = [
  { name: "Home", href: "/dashboard", icon: Home },
  { name: "Groups", href: "/groups", icon: Users },
  { name: "Admin", href: "/admin", icon: Shield },
];

export function AppNavbar({ user }: { user: any }) {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  // The `(app)/layout` passes the raw Supabase user, where the
  // onboarding nickname lives under `user_metadata.nickname`. The
  // older prisma shape also exposes it directly on `user.nickname`.
  // Resolve the display nickname across both shapes so the brand
  // chip in the navbar always has a non-empty value when signed in.
  const displayName: string | undefined =
    user?.user_metadata?.nickname ?? user?.nickname;

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16 items-center">
          {/* Logo / Brand */}
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 group"
              aria-label="Predicty home"
            >
              <span
                aria-hidden="true"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-primary transition-colors group-hover:text-foreground"
              >
                <Goal className="h-4 w-4" />
              </span>
              <span className="font-display text-2xl font-bold tracking-tight">
                Predictyy
              </span>
            </Link>
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-6">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.name}
                </Link>
              );
            })}
            <span
              aria-disabled="true"
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground/50 cursor-not-allowed select-none"
              title="Settings (coming soon)"
            >
              <Settings className="h-4 w-4" />
              Settings
            </span>
          </div>

          {/* User Profile / Mobile Menu Button */}
          <div className="flex items-center gap-4">
            {displayName && (
              <div className="hidden sm:flex items-center gap-2">
                <CrestSlot name={displayName} size="sm" />
                <span className="text-sm font-medium">{displayName}</span>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className="md:hidden p-2 text-muted-foreground"
              aria-label={isOpen ? "Close menu" : "Open menu"}
              aria-expanded={isOpen}
            >
              {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      {isOpen && (
        <div className="md:hidden border-t border-border bg-background px-4 py-4 space-y-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-3 text-base font-medium transition-colors ${
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}
          <span
            aria-disabled="true"
            className="flex items-center gap-3 text-base font-medium text-muted-foreground/50 cursor-not-allowed select-none"
            title="Settings (coming soon)"
          >
            <Settings className="h-5 w-5" />
            Settings
          </span>
        </div>
      )}
    </nav>
  );
}
