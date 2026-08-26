import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { AppRole } from './AuthContext';
import { useAuth } from './AuthContext';

export default function ProtectedRoute({ roles }: { roles: AppRole[] }) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="min-h-screen bg-slate-100 flex items-center justify-center"><div className="h-10 w-10 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" /></div>;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!profile || !roles.includes(profile.role)) return <Navigate to="/sem-acesso" replace />;
  return <Outlet />;
}
