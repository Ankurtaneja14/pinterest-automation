import type { ReactNode } from "react";
import Link from "next/link";
import {
  CircleHelp,
  Clock3,
  Cpu,
  History,
  Images,
  LayoutDashboard,
  Lightbulb,
  ListOrdered,
  Search,
  Send,
  Settings2,
  Sparkles,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavSectionKey =
  | "overview"
  | "schedules"
  | "research"
  | "ideas"
  | "images"
  | "settings"
  | "pinterest-accounts"
  | "pinterest-publish"
  | "pinterest-queue"
  | "pinterest-history"
  | "pinterest-engine";

interface NavItem {
  label: string;
  icon: LucideIcon;
  href?: string;
  key: NavSectionKey;
}

const workspaceNavigation: NavItem[] = [
  { label: "Overview", icon: LayoutDashboard, href: "/", key: "overview" },
  { label: "Schedules", icon: Clock3, href: "/schedules", key: "schedules" },
  { label: "Research", icon: Search, href: "/research", key: "research" },
  { label: "Ideas", icon: Lightbulb, href: "/ideas", key: "ideas" },
  { label: "Content library", icon: Images, href: "/images", key: "images" },
  { label: "AI Settings", icon: Settings2, href: "/settings/ai", key: "settings" },
];

const publishingNavigation: NavItem[] = [
  { label: "Pinterest Accounts", icon: Users, href: "/pinterest/accounts", key: "pinterest-accounts" },
  { label: "Publishing Center", icon: Send, href: "/pinterest/publish", key: "pinterest-publish" },
  { label: "Publishing Queue", icon: ListOrdered, href: "/pinterest/queue", key: "pinterest-queue" },
  { label: "Publishing History", icon: History, href: "/pinterest/history", key: "pinterest-history" },
  { label: "Engine Controller", icon: Cpu, href: "/pinterest/engine", key: "pinterest-engine" },
];

const allNavItems = [...workspaceNavigation, ...publishingNavigation];

interface DashboardShellProps {
  activeSection: NavSectionKey;
  children: ReactNode;
}

export function DashboardShell({
  activeSection,
  children,
}: DashboardShellProps) {
  const activeLabel =
    allNavItems.find((item) => item.key === activeSection)?.label ?? "Overview";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={18} strokeWidth={2.2} />
          </div>
          <div className="brand-copy">
            <span className="brand-name">pinpoint</span>
            <span className="brand-caption">CONTENT ENGINE</span>
          </div>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">P</div>
          <div className="workspace-copy">
            <span className="workspace-name">Pinterest workspace</span>
            <span className="workspace-plan">Multi-account publishing</span>
          </div>
          <span className="switcher-dots">···</span>
        </div>

        <div className="nav-section-label">WORKSPACE</div>
        <nav className="navigation" aria-label="Workspace navigation">
          {workspaceNavigation.map(({ label, icon: Icon, href, key }) => {
            const active = key === activeSection;
            const className = `nav-item${active ? " nav-item-active" : ""}`;
            return (
              <Link
                className={className}
                href={href ?? "#"}
                key={label}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="nav-section-label">
          PUBLISHING ENGINE
        </div>
        <nav className="navigation" aria-label="Publishing navigation">
          {publishingNavigation.map(({ label, icon: Icon, href, key }) => {
            const active = key === activeSection;
            const className = `nav-item${active ? " nav-item-active" : ""}`;
            return (
              <Link
                className={className}
                href={href ?? "#"}
                key={label}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="engine-status">
            <span className="status-dot" />
            <span>Database-backed publishing</span>
          </div>
          <div className="sidebar-footer">
            <div className="user-avatar">HP</div>
            <div className="workspace-copy">
              <span className="workspace-name">Local workspace</span>
              <span className="workspace-plan">Multi-account setup</span>
            </div>
            <CircleHelp size={17} className="help-icon" />
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="breadcrumb-separator">/</span>
            <strong>{activeLabel}</strong>
          </div>
          <div className="topbar-actions">
            <span className="milestone-pill">
              <span className="status-dot" />
              Publishing Engine Active
            </span>
            <div className="topbar-avatar">HP</div>
          </div>
        </header>
        {children}
      </section>
    </main>
  );
}
