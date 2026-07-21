import { Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import SalesEntry from "./pages/SalesEntry.jsx";
import Opname from "./pages/Opname.jsx";
import ProductionBatch from "./pages/ProductionBatch.jsx";
import Ingredients from "./pages/Ingredients.jsx";
import Menus from "./pages/Menus.jsx";
import Vendors from "./pages/Vendors.jsx";
import PurchaseOrders from "./pages/PurchaseOrders.jsx";
import DailyPurchaseEntry from "./pages/DailyPurchaseEntry.jsx";
import Variance from "./pages/Variance.jsx";
import Reports from "./pages/Reports.jsx";
import Units from "./pages/Units.jsx";
import ProductionProcesses from "./pages/ProductionProcesses.jsx";
import HPPManagement from "./pages/HPPManagement.jsx";
import HPPAnalysis from "./pages/HPPAnalysis.jsx";
import Waste from "./pages/Waste.jsx";
import DailySales from "./pages/DailySales.jsx";
import StockLevels from "./pages/StockLevels.jsx";
import InitialStock from "./pages/InitialStock.jsx";
import TransferItem from "./pages/TransferItem.jsx";
import PurchaseReport from "./pages/PurchaseReport.jsx";

function PrivateRoute({ children }) {
  const token = localStorage.getItem("access_token");
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
      <Route path="/sales-entry" element={<PrivateRoute><SalesEntry /></PrivateRoute>} />
      <Route path="/opname" element={<PrivateRoute><Opname /></PrivateRoute>} />
      <Route path="/production-batch" element={<PrivateRoute><ProductionBatch /></PrivateRoute>} />
      <Route path="/ingredients" element={<PrivateRoute><Ingredients /></PrivateRoute>} />
      <Route path="/menus" element={<PrivateRoute><Menus /></PrivateRoute>} />
      <Route path="/vendors" element={<PrivateRoute><Vendors /></PrivateRoute>} />
      <Route path="/purchase-orders" element={<PrivateRoute><PurchaseOrders /></PrivateRoute>} />
      <Route path="/daily-purchase" element={<PrivateRoute><DailyPurchaseEntry /></PrivateRoute>} />
      <Route path="/purchase-report" element={<PrivateRoute><PurchaseReport /></PrivateRoute>} />
      <Route path="/variance" element={<PrivateRoute><Variance /></PrivateRoute>} />
      <Route path="/reports" element={<PrivateRoute><Reports /></PrivateRoute>} />
      <Route path="/units" element={<PrivateRoute><Units /></PrivateRoute>} />
      <Route path="/production-processes" element={<PrivateRoute><ProductionProcesses /></PrivateRoute>} />
      <Route path="/hpp-management" element={<PrivateRoute><HPPManagement /></PrivateRoute>} />
      <Route path="/hpp-analysis" element={<PrivateRoute><HPPAnalysis /></PrivateRoute>} />
      <Route path="/waste" element={<PrivateRoute><Waste /></PrivateRoute>} />
      <Route path="/daily-sales" element={<PrivateRoute><DailySales /></PrivateRoute>} />
      <Route path="/stock-levels" element={<PrivateRoute><StockLevels /></PrivateRoute>} />
      <Route path="/initial-stock" element={<PrivateRoute><InitialStock /></PrivateRoute>} />
      <Route path="/transfer-item" element={<PrivateRoute><TransferItem /></PrivateRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
