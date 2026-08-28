import React from 'react';
import { Check, Circle } from 'lucide-react';
import { getPasswordRequirements } from '../lib/password-security';

export default function PasswordRequirements({ password }: { password: string }) {
  return (
    <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
      {getPasswordRequirements(password).map((requirement) => (
        <div key={requirement.id} className={`flex items-center gap-2 text-xs font-bold ${requirement.met ? 'text-emerald-700' : 'text-slate-500'}`}>
          {requirement.met ? <Check size={15} aria-hidden="true" /> : <Circle size={12} aria-hidden="true" />}
          <span>{requirement.label}</span>
        </div>
      ))}
    </div>
  );
}

