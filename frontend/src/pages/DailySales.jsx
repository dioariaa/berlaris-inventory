import { useState, useEffect, useCallback } from "react";
import PageWrapper from "../components/layout/PageWrapper.jsx";
import { formatRupiah } from "../lib/utils.js";
import api from "../lib/api.js";
import { TrendingUp, TrendingDown, RefreshCw } from "lucide-react";

function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}

const CATEGORY_LABEL = {
  breakfast:         "Breakfast",
  snack:             "Snack",
  main_course:       "Main Course",
  soup:              "Soup",
  burger_sandwich:   "Burger & Sandwich",
  pasta:             "Pasta",
  salad:             "Salad",
  dessert:           "Dessert",
  rice_bowl:         "Rice Bowl",
  beverage_coffee:   "Coffee",
  beverage_tea:      "Tea",
  beverage_mocktail: "Mocktail",
  other:             "Lainnya",
};

export default function DailySales() {
  const [date, setDate] = useState(todayStr());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (d) => {
    setLoading(true);
    try {
      const res = await api.get(`/dashboard/daily-sales?date=${d}`);
      setData(res.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const cmp = data?.comparison_vs_yesterday ?? {};
  const top5 = data?.top5 ?? [];
  const byCat = data?.by_category ?? [];
  const maxCatRev = byCat.length > 0 ? Math.max(...byCat.map(c => c.revenue), 1) : 1;

  function DeltaChip({ pct }) {
    if (pct == null) return <span className="text-xs text-gray-400">—</span>;
    const up = pct > 0;
    return (
      <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full
        ${up ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
        {up ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
        {Math.abs(pct)}%
      </span>
    );
  }

  return (
    <PageWrapper>
      {/* Date picker */}
      <div className="flex items-center gap-3 mb-6">
        <label className="text-sm font-semibold" style={{ color: "#6e6155" }}>Tanggal</label>
        <input
          type="date"
          value={date}
          max={todayStr()}
          onChange={e => setDate(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "#e7ded1", background: "#faf8f5" }}
        />
        <button
          onClick={() => load(date)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 disabled:opacity-50"
          style={{ borderColor: "#e7ded1" }}
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-sm text-gray-400">Memuat data...</div>
      ) : !data ? (
        <div className="text-center py-16 text-sm text-gray-400">Gagal memuat data penjualan</div>
      ) : (
        <div className="space-y-5">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <KpiCard
              title="Revenue"
              value={formatRupiah(data.revenue)}
              sub={`vs kemarin: ${formatRupiah(cmp.yesterday_revenue)}`}
              chip={<DeltaChip pct={cmp.revenue_delta_pct} />}
              accent="#22c55e"
            />
            <KpiCard
              title="Total Porsi Terjual"
              value={`${data.porsi} porsi`}
              sub={`vs kemarin: ${cmp.yesterday_porsi} porsi`}
              chip={<DeltaChip pct={cmp.porsi_delta_pct} />}
              accent="#6f4422"
            />
            <KpiCard
              title="Menu Terjual"
              value={`${data.menu_count} menu`}
              sub="jumlah menu berbeda"
              accent="#6366f1"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Top 5 Menu */}
            <div className="rounded-2xl border overflow-hidden" style={{ background: "#fff", borderColor: "#e7ded1" }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: "#e7ded1" }}>
                <h3 className="font-display font-bold text-sm" style={{ color: "#2a211b" }}>Top 5 Menu Terjual</h3>
              </div>
              {top5.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">Belum ada data penjualan</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "#faf8f5", borderBottom: "1px solid #e7ded1" }}>
                      {["#", "Menu", "Qty", "Revenue"].map(h => (
                        <th key={h} className="text-left px-4 py-2 text-xs font-semibold" style={{ color: "#6e6155" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {top5.map((m, idx) => (
                      <tr key={m.menu_id} className="border-b" style={{ borderColor: "#f0ebe4" }}>
                        <td className="px-4 py-2.5 font-bold text-xs" style={{ color: "#a09080" }}>{idx + 1}</td>
                        <td className="px-4 py-2.5 font-medium" style={{ color: "#2a211b" }}>
                          {m.name}
                          <div className="text-xs" style={{ color: "#a09080" }}>
                            {CATEGORY_LABEL[m.category] || m.category}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-semibold" style={{ color: "#6f4422" }}>{m.qty}</td>
                        <td className="px-4 py-2.5 text-xs" style={{ color: "#2a211b" }}>
                          {formatRupiah(m.revenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Revenue by Category */}
            <div className="rounded-2xl border overflow-hidden" style={{ background: "#fff", borderColor: "#e7ded1" }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: "#e7ded1" }}>
                <h3 className="font-display font-bold text-sm" style={{ color: "#2a211b" }}>Revenue per Kategori</h3>
              </div>
              {byCat.length === 0 ? (
                <div className="p-8 text-center text-sm text-gray-400">Belum ada data penjualan</div>
              ) : (
                <div className="p-4 space-y-3">
                  {byCat.map((c, idx) => (
                    <div key={c.category}>
                      <div className="flex justify-between text-xs mb-1">
                        <span style={{ color: "#2a211b", fontWeight: 500 }}>
                          {CATEGORY_LABEL[c.category] || c.category}
                        </span>
                        <span style={{ color: "#6f4422", fontWeight: 600 }}>
                          {formatRupiah(c.revenue)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: "#f0ebe4" }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${(c.revenue / maxCatRev) * 100}%`,
                            background: idx === 0 ? "#6f4422" : idx === 1 ? "#a0643a" : "#c8906a",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </PageWrapper>
  );
}

function KpiCard({ title, value, sub, chip, accent }) {
  return (
    <div className="rounded-2xl border p-4" style={{ background: "#fff", borderColor: "#e7ded1" }}>
      <p className="text-xs font-semibold mb-2" style={{ color: "#6e6155" }}>{title}</p>
      <p className="font-display font-bold text-xl leading-tight mb-1" style={{ color: accent ?? "#2a211b" }}>
        {value}
      </p>
      <div className="flex items-center gap-2">
        {chip}
        {sub && <span className="text-xs" style={{ color: "#a09080" }}>{sub}</span>}
      </div>
    </div>
  );
}
