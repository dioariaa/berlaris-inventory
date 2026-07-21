import { useState } from "react";
import Sidebar from "./Sidebar.jsx";
import Header from "./Header.jsx";

export default function PageWrapper({ title, children }) {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden relative bg-background">
      {/* Mobile scrim */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: "rgba(30,20,12,.42)", backdropFilter: "blur(1px)" }}
        />
      )}

      <Sidebar navOpen={navOpen} onClose={() => setNavOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header title={title} onMenuClick={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-5 lg:p-7">
          {children}
        </main>
      </div>
    </div>
  );
}
