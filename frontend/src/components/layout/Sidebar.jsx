import { useState, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import api from "../../lib/api.js";

const ACCENT  = "#6f4422";
const SB_BG   = "#241a13";
const SB_BORD = "rgba(255,255,255,.07)";
const SB_TEXT  = "rgba(245,238,230,.78)";
const SB_MUTED = "rgba(245,238,230,.42)";

const NAV_GROUPS = [
  {
    label: "Operasional",
    items: [
      { label: "Dashboard",      to: "/",                 icon: "space_dashboard" },
      { label: "Sales Entry",    to: "/sales-entry",      icon: "point_of_sale" },
      { label: "Opname",         to: "/opname",           icon: "fact_check" },
      { label: "Produksi",       to: "/production-batch", icon: "precision_manufacturing" },
      { label: "Belanja Harian", to: "/daily-purchase",   icon: "receipt_long" },
      { label: "Rekap Belanja",  to: "/purchase-report",  icon: "pie_chart" },
      { label: "Purchase Order", to: "/purchase-orders",  icon: "shopping_cart_checkout" },
      { label: "Variance",       to: "/variance",         icon: "monitoring" },
    ],
  },
  {
    label: "Master Data",
    items: [
      { label: "Bahan Baku",         to: "/ingredients",          icon: "inventory_2" },
      { label: "Menu & Resep",       to: "/menus",                icon: "restaurant_menu" },
      { label: "Vendor",             to: "/vendors",              icon: "local_shipping" },
      { label: "Satuan",             to: "/units",                icon: "straighten" },
      { label: "Proses Produksi",    to: "/production-processes", icon: "account_tree" },
    ],
  },
  {
    label: "Monitoring",
    items: [
      { label: "Stok Real-Time",     to: "/stock-levels",         icon: "inventory" },
      { label: "Transfer Item",      to: "/transfer-item",        icon: "swap_horiz" },
      { label: "Informasi Penjualan", to: "/daily-sales",         icon: "trending_up" },
      { label: "Waste Log",          to: "/waste",                icon: "delete_sweep" },
    ],
  },
  // "Stok Awal" ditambahkan dinamis di bawah — hanya tampil kalau belum diisi
  {
    label: "HPP & Costing",
    items: [
      { label: "HPP Management",     to: "/hpp-management",       icon: "calculate" },
      { label: "Analisis HPP",       to: "/hpp-analysis",         icon: "query_stats" },
      { label: "Laporan",            to: "/reports",              icon: "bar_chart" },
    ],
  },
];

export default function Sidebar({ navOpen, onClose }) {
  const navigate = useNavigate();
  const raw  = localStorage.getItem("user_info");
  const user = raw ? JSON.parse(raw) : null;

  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    api.get("/stock/initial")
      .then((res) => setPendingCount(res.data?.pending_count ?? 0))
      .catch(() => {});
  }, []);

  const navGroups = NAV_GROUPS.map((group) => {
    if (group.label !== "Monitoring" || pendingCount <= 0) return group;
    return {
      ...group,
      items: [...group.items, { label: "Stok Awal", to: "/initial-stock", icon: "inventory_2", badge: pendingCount }],
    };
  });

  const initials = user?.full_name
    ? user.full_name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()
    : (user?.email?.[0] ?? "U").toUpperCase();

  function logout() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("user_info");
    navigate("/login");
  }

  return (
    <aside
      style={{ background: SB_BG, borderRight: `1px solid ${SB_BORD}`, width: 252 }}
      className={[
        "flex flex-col shrink-0 z-50",
        /* desktop: always visible, in normal flow */
        "lg:static lg:inset-auto lg:translate-x-0 lg:shadow-none",
        /* mobile: fixed overlay, slides in/out */
        "fixed top-0 left-0 bottom-0",
        "transition-transform duration-[260ms] ease-[cubic-bezier(.4,0,.2,1)]",
        navOpen ? "translate-x-0 shadow-[0_20px_60px_rgba(20,12,6,.45)]" : "-translate-x-full",
      ].join(" ")}
    >
      {/* ── Logo ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-5 shrink-0">
        <div style={{
          width: 38, height: 38, borderRadius: 11,
          background: ACCENT, display: "flex", alignItems: "center",
          justifyContent: "center", flexShrink: 0,
          boxShadow: "0 4px 12px rgba(111,68,34,.35)",
        }}>
          <span className="msr" style={{ fontSize: 22, color: "#fff" }}>coffee</span>
        </div>
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontFamily: "'Schibsted Grotesk'", fontWeight: 700, fontSize: 17, color: "#fbf7f1", letterSpacing: "-0.01em" }}>
            Berlaris
          </div>
          <div style={{ fontSize: 11, color: SB_MUTED, fontWeight: 500 }}>
            Inventory F&B
          </div>
        </div>
      </div>

      {/* ── Nav groups ────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto px-3 pb-3">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-1">
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: SB_MUTED, padding: "10px 12px 4px" }}>
              {group.label}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.items.map(({ label, to, icon, badge }) => (
                <NavLink key={to} to={to} end={to === "/"} onClick={onClose} className="block">
                  {({ isActive }) => (
                    <div
                      style={{
                        position: "relative",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "9px 12px",
                        borderRadius: 10,
                        cursor: "pointer",
                        background: isActive ? "rgba(255,255,255,.09)" : "transparent",
                        color: isActive ? "#fff" : SB_TEXT,
                        fontWeight: isActive ? 600 : 500,
                        fontSize: 13.5,
                        transition: "background .12s",
                      }}
                    >
                      {isActive && (
                        <span style={{
                          position: "absolute", left: -12, top: 7, bottom: 7,
                          width: 3, borderRadius: "0 3px 3px 0", background: ACCENT,
                        }} />
                      )}
                      <span className="msr" style={{ fontSize: 19, color: isActive ? ACCENT : SB_MUTED }}>
                        {icon}
                      </span>
                      <span style={{ flex: 1 }}>{label}</span>
                      {badge > 0 && (
                        <span style={{
                          fontSize: 10, fontWeight: 700, lineHeight: 1,
                          padding: "2px 6px", borderRadius: 8,
                          background: "#dc2626", color: "#fff",
                        }}>{badge}</span>
                      )}
                    </div>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* ── User / logout ─────────────────────────────────────────── */}
      <div style={{ borderTop: `1px solid ${SB_BORD}`, padding: 12, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 10px", borderRadius: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: "50%",
            background: `linear-gradient(135deg,${ACCENT},#3a2a1d)`,
            color: "#fff", display: "flex", alignItems: "center",
            justifyContent: "center", fontWeight: 700, fontSize: 13, flexShrink: 0,
          }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#fbf7f1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user?.full_name || user?.email || "User"}
            </div>
            <div style={{ fontSize: 11, color: SB_MUTED }}>{user?.role || "—"}</div>
          </div>
          <button
            onClick={logout}
            title="Keluar"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, lineHeight: 1 }}
          >
            <span className="msr" style={{ fontSize: 19, color: SB_MUTED }}>logout</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
