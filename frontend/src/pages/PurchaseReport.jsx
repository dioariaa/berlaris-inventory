import { useState, useEffect, useCallback, Fragment } from "react";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import Toast from "../components/ui/Toast.jsx";
import { formatRupiah } from "../lib/utils.js";
import api from "../lib/api.js";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  Wallet, ReceiptText, ChevronDown, ChevronRight, RefreshCw, CalendarDays,
} from "lucide-react";

const DIVISION_LABEL = {
  storage_kitchen: "Storage Kitchen",
  storage_bar:     "Storage Bar",
  kitchen:         "Kitchen",
  bar:             "Bar",
  staff_meal:      "Staff Meal",
  operational:     "Operational",
  lainnya:         "Lainnya",
};

function localDate(d) {
  return d.toLocaleDateString("sv-SE");
}

// ── Period presets ────────────────────────────────────────────────────────────

const PRESETS = [
  { value: "today",      label: "Hari Ini" },
  { value: "week",       label: "Minggu Ini" },
  { value: "month",      label: "Bulan Ini" },
  { value: "last_month", label: "Bulan Lalu" },
  { value: "custom",     label: "Custom" },
];

function presetRange(preset) {
  const now = new Date();
  switch (preset) {
    case "today":
      return [localDate(now), localDate(now)];
    case "week": {
      // Senin minggu berjalan → hari ini
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      return [localDate(monday), localDate(now)];
    }
    case "last_month": {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last  = new Date(now.getFullYear(), now.getMonth(), 0);
      return [localDate(first), localDate(last)];
    }
    case "month":
    default:
      return [localDate(new Date(now.getFullYear(), now.getMonth(), 1)), localDate(now)];
  }
}

function fmtQty(n) {
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 3 });
}

function fmtShortDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

// ── Drill-down item table (dipakai division & vendor) ─────────────────────────

function ItemDetailTable({ items, showDate = false }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-muted/30 text-xs text-muted-foreground">
          <th className="text-left px-4 py-1.5 font-medium">Bahan</th>
          {showDate && <th className="text-left px-4 py-1.5 font-medium w-32">Tanggal</th>}
          <th className="text-right px-4 py-1.5 font-medium w-32">Total Qty</th>
          {!showDate && <th className="text-right px-4 py-1.5 font-medium w-32">Rata-rata /unit</th>}
          <th className="text-right px-4 py-1.5 font-medium w-32">Total</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {items.map((it, i) => (
          <tr key={i}>
            <td className="px-4 py-1.5">{it.ingredient_name}</td>
            {showDate && (
              <td className="px-4 py-1.5 text-muted-foreground">{it.date ? fmtShortDate(it.date) : "—"}</td>
            )}
            <td className="px-4 py-1.5 text-right text-muted-foreground">
              {fmtQty(it.total_qty)} {it.unit}
            </td>
            {!showDate && (
              <td className="px-4 py-1.5 text-right text-muted-foreground">{formatRupiah(it.avg_price)}</td>
            )}
            <td className="px-4 py-1.5 text-right font-medium">{formatRupiah(it.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PurchaseReport() {
  const [preset,    setPreset]    = useState("month");
  const [[startDate, endDate], setRange] = useState(() => presetRange("month"));
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [toast,     setToast]     = useState(null);
  const [openDivs,  setOpenDivs]  = useState(new Set());
  const [openVnds,  setOpenVnds]  = useState(new Set());

  const load = useCallback(async (start, end) => {
    setLoading(true);
    try {
      const res = await api.get("/reports/purchases", {
        params: { start_date: start, end_date: end },
      });
      setData(res.data);
      setOpenDivs(new Set());
      setOpenVnds(new Set());
    } catch (err) {
      setToast({ message: err.response?.data?.detail || "Gagal memuat rekap belanja", type: "error" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(startDate, endDate); }, [startDate, endDate, load]);

  function selectPreset(p) {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
  }

  const toggle = (setter) => (key) =>
    setter((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const toggleDiv = toggle(setOpenDivs);
  const toggleVnd = toggle(setOpenVnds);

  return (
    <PageWrapper title="Rekap Belanja">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── Filter bar ── */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => selectPreset(p.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              preset === p.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground hover:border-primary/50"
            }`}
          >
            {p.label}
          </button>
        ))}

        <div className="flex items-center gap-2 ml-auto">
          <CalendarDays size={14} className="text-muted-foreground" />
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => { setPreset("custom"); setRange([e.target.value, endDate]); }}
            className="border rounded-lg px-2 py-1.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <span className="text-muted-foreground text-sm">s/d</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => { setPreset("custom"); setRange([startDate, e.target.value]); }}
            className="border rounded-lg px-2 py-1.5 text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      {loading || !data ? (
        <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
          <RefreshCw size={16} className="animate-spin mr-2" /> Memuat rekap…
        </div>
      ) : (
        <>
          {/* ── Section 1: Ringkasan ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-xl">
                <Wallet size={22} className="text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Pengeluaran</p>
                <p className="text-2xl font-bold text-foreground">{formatRupiah(data.total_amount)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fmtShortDate(data.start_date)} – {fmtShortDate(data.end_date)}
                </p>
              </div>
            </div>
            <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-xl">
                <ReceiptText size={22} className="text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Transaksi Belanja</p>
                <p className="text-2xl font-bold text-foreground">{data.transaction_count}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{data.item_count} item dibeli</p>
              </div>
            </div>
          </div>

          {data.total_amount === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm gap-2 bg-card border border-border rounded-xl">
              <Wallet size={32} className="opacity-30" />
              Tidak ada belanja pada periode ini
            </div>
          ) : (
            <>
              {/* ── Section 4: Tren harian ── */}
              {data.daily.length > 1 && (
                <div className="bg-card border border-border rounded-xl p-4 mb-6">
                  <p className="text-sm font-semibold mb-3">Tren Pengeluaran Harian</p>
                  <div className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data.daily} margin={{ top: 4, right: 12, left: 12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.06)" />
                        <XAxis dataKey="date" tickFormatter={fmtShortDate} tick={{ fontSize: 11 }} />
                        <YAxis
                          tick={{ fontSize: 11 }}
                          tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toLocaleString("id-ID")}jt` : `${(v / 1e3).toLocaleString("id-ID")}rb`)}
                          width={52}
                        />
                        <Tooltip
                          formatter={(v) => [formatRupiah(v), "Total"]}
                          labelFormatter={fmtShortDate}
                        />
                        <Line type="monotone" dataKey="total" stroke="#6f4422" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* ── Section 2: Per Division ── */}
              <div className="bg-card border border-border rounded-xl mb-6 overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-sm font-semibold">Rekap per Division</p>
                  <p className="text-xs text-muted-foreground">Klik baris untuk lihat rincian item</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-xs text-muted-foreground">
                      <th className="text-left px-4 py-2 font-medium">Division</th>
                      <th className="text-right px-4 py-2 font-medium w-40">Total</th>
                      <th className="text-right px-4 py-2 font-medium w-24">% Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.by_division.map((d) => (
                      <Fragment key={d.division}>
                        <tr
                          onClick={() => toggleDiv(d.division)}
                          className="cursor-pointer hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-2.5 font-medium">
                            <span className="inline-flex items-center gap-2">
                              {openDivs.has(d.division) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              {DIVISION_LABEL[d.division] ?? d.division}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium">{formatRupiah(d.total)}</td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground">{d.pct}%</td>
                        </tr>
                        {openDivs.has(d.division) && (
                          <tr>
                            <td colSpan={3} className="bg-muted/10 px-2 py-2">
                              <ItemDetailTable items={d.items} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ── Section 3: Per Vendor ── */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <p className="text-sm font-semibold">Rekap per Vendor</p>
                  <p className="text-xs text-muted-foreground">Klik baris untuk lihat item yang dibeli dari vendor</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-xs text-muted-foreground">
                      <th className="text-left px-4 py-2 font-medium">Vendor</th>
                      <th className="text-right px-4 py-2 font-medium w-28">Transaksi</th>
                      <th className="text-right px-4 py-2 font-medium w-40">Total</th>
                      <th className="text-right px-4 py-2 font-medium w-24">% Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.by_vendor.map((v) => (
                      <Fragment key={v.vendor_id}>
                        <tr
                          onClick={() => toggleVnd(v.vendor_id)}
                          className="cursor-pointer hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-4 py-2.5 font-medium">
                            <span className="inline-flex items-center gap-2">
                              {openVnds.has(v.vendor_id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              {v.vendor_name}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground">{v.transaction_count}</td>
                          <td className="px-4 py-2.5 text-right font-medium">{formatRupiah(v.total)}</td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground">{v.pct}%</td>
                        </tr>
                        {openVnds.has(v.vendor_id) && (
                          <tr>
                            <td colSpan={4} className="bg-muted/10 px-2 py-2">
                              <ItemDetailTable items={v.items} showDate />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </PageWrapper>
  );
}
