import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

const PAGE_META = {
  "/":                       { title: "Dashboard",           sub: "Ringkasan operasional harian" },
  "/sales-entry":            { title: "Sales Entry",         sub: "Input penjualan menu hari ini" },
  "/opname":                 { title: "Stock Opname",        sub: "Hitung fisik stok harian" },
  "/production-batch":       { title: "Produksi",            sub: "Log batch produksi kitchen" },
  "/daily-purchase":         { title: "Belanja Harian",      sub: "Catat pembelian bahan tanpa PO" },
  "/ingredients":            { title: "Bahan Baku",          sub: "Master data ingredient" },
  "/menus":                  { title: "Menu & Resep",        sub: "Menu aktif & komposisi bahan (BOM)" },
  "/vendors":                { title: "Vendor",              sub: "Daftar vendor & supplier" },
  "/purchase-orders":        { title: "Purchase Order",      sub: "Manajemen PO & penerimaan barang" },
  "/variance":               { title: "Variance",            sub: "Laporan variance per periode" },
  "/reports":                { title: "Laporan",             sub: "Ekspor laporan audit & food cost" },
  "/units":                  { title: "Satuan",              sub: "Kelola satuan ukuran & tabel konversi" },
  "/production-processes":   { title: "Proses Produksi",     sub: "Konfigurasi rantai produksi raw → processed" },
  "/hpp-management":         { title: "HPP Management",      sub: "Harga Pokok Produksi per menu & food cost" },
  "/hpp-analysis":           { title: "Analisis HPP",        sub: "Trend food cost % antar periode & dampak perubahan harga bahan" },
  "/waste":                  { title: "Waste Log",           sub: "Catat & pantau bahan terbuang" },
  "/daily-sales":            { title: "Informasi Penjualan", sub: "Analisis penjualan harian per menu & kategori" },
  "/stock-levels":           { title: "Stok Real-Time",      sub: "Posisi stok semua bahan saat ini" },
  "/initial-stock":          { title: "Stok Awal",           sub: "Input stok fisik awal saat sistem mulai dipakai" },
};

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function Header({ title, onMenuClick }) {
  const location = useLocation();
  const now      = useClock();
  const meta     = PAGE_META[location.pathname] ?? { title: title ?? "", sub: "" };

  const raw  = localStorage.getItem("user_info");
  const user = raw ? JSON.parse(raw) : null;

  const dateLabel = now.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
  const timeLabel = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + " WIB";

  return (
    <header
      style={{
        background: "rgba(249,246,240,.88)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid #e7ded1",
        height: 66,
        flexShrink: 0,
      }}
      className="flex items-center gap-3 px-4 lg:px-7"
    >
      {/* Mobile hamburger */}
      <button
        onClick={onMenuClick}
        className="lg:hidden w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 hover:bg-white/60 transition-colors"
        style={{ borderColor: "#e7ded1", background: "transparent" }}
      >
        <span className="msr" style={{ fontSize: 22, color: "#2a211b" }}>menu</span>
      </button>

      {/* Title + subtitle */}
      <div className="flex-1 min-w-0">
        <h1 className="font-display font-bold leading-tight truncate" style={{ fontSize: "clamp(15px,2.2vw,20px)", letterSpacing: "-0.02em", color: "#2a211b", margin: 0 }}>
          {meta.title}
        </h1>
        {meta.sub && (
          <p className="text-xs font-medium truncate" style={{ color: "#8a7d6e" }}>
            {meta.sub}
          </p>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* Date + time — hidden on very small screens */}
        <div className="hidden sm:flex flex-col items-end leading-tight">
          <span className="text-xs font-semibold" style={{ color: "#2a211b" }}>{dateLabel}</span>
          <span className="text-xs" style={{ color: "#8a7d6e" }}>{timeLabel}</span>
        </div>

        {/* User badge */}
        {user && (
          <div
            className="flex items-center gap-2 pl-3"
            style={{ borderLeft: "1px solid #e7ded1" }}
          >
            <div className="hidden md:block text-right leading-tight">
              <p className="text-xs font-semibold truncate max-w-[120px]" style={{ color: "#2a211b" }}>
                {user.full_name || user.email}
              </p>
            </div>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize"
              style={
                user.role === "admin"
                  ? { background: "rgba(111,68,34,.12)", color: "#6f4422" }
                  : { background: "#f0ede8", color: "#6e6155" }
              }
            >
              {user.role}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
