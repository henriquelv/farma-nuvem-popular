import React, { useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Users, Pill, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

export default function Layout() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);
  const { profile, signOut } = useAuth();
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, left: 0 });
  }, [location.pathname]);

  return (
    <div className="flex h-dvh bg-slate-100 text-slate-900 font-sans relative overflow-hidden">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 bg-white border-r border-slate-200 flex-col z-10 relative flex-shrink-0">
        <div className="p-6 flex items-center gap-3 border-b border-slate-100">
          <div className="bg-blue-600 text-white p-2 rounded-lg">
            <Pill size={24} />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight text-slate-800">Farmácia Popular</h1>
            <p className="text-xs text-slate-500 font-medium tracking-wide uppercase">Auditoria</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <NavLink
            to="/clientes"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`
            }
          >
            <Users size={20} />
            <span>Clientes</span>
          </NavLink>

          {isAdmin && <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? 'bg-slate-900 text-white font-semibold shadow-lg shadow-slate-900/10'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`
            }
          >
            <Settings size={20} />
            <span>Admin</span>
          </NavLink>}

        </nav>
        <div className="border-t border-slate-100 p-4">
          <p className="truncate px-2 text-sm font-black text-slate-700">{profile?.full_name}</p>
          <p className="mb-3 px-2 text-xs font-bold capitalize text-slate-400">{profile?.role}</p>
          <button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-900">
            <LogOut size={18} /> Sair
          </button>
        </div>

      </aside>

      <header className="md:hidden fixed inset-x-0 top-0 z-30 h-16 bg-white border-b border-slate-200 flex items-center px-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center flex-shrink-0">
            <Pill size={20} />
          </div>
          <div className="min-w-0">
            <p className="font-black text-slate-900 truncate">Farmácia Popular</p>
            <p className="text-[10px] font-bold uppercase text-slate-400">Auditoria</p>
          </div>
        </div>
      </header>

      <nav className={`md:hidden fixed inset-x-0 bottom-0 z-30 bg-white border-t border-slate-200 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] grid gap-2 ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'}`}>
        <NavLink to="/clientes" className={({ isActive }) => `h-12 rounded-lg flex items-center justify-center gap-2 text-sm font-black ${isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-500'}`}>
          <Users size={19} /> Pacientes
        </NavLink>
        {isAdmin && <NavLink to="/admin" className={({ isActive }) => `h-12 rounded-lg flex items-center justify-center gap-2 text-sm font-black ${isActive ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>
          <Settings size={19} /> Admin
        </NavLink>}
        <button type="button" onClick={() => void signOut()} className="h-12 rounded-lg flex items-center justify-center gap-2 text-sm font-black text-slate-500">
          <LogOut size={19} /> Sair
        </button>
      </nav>

      {/* Main Content */}
      <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto bg-slate-100 relative z-10 pt-16 pb-20 md:pt-0 md:pb-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
