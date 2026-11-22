import { useState } from 'react';
import { api } from '../api.ts';

export function Login({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="li-splash">
      <form className="li-login" onSubmit={async (e) => { e.preventDefault(); try { await api.login(pin); onDone(); } catch (x) { setErr((x as Error).message); } }}>
        <div className="li-brand big"><span className="li-logo">LEONIDA</span><span className="li-logo2">INTELLIGENCE</span></div>
        <p>Enter the access PIN set on the host computer.</p>
        <input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} aria-label="PIN" className="li-input" />
        {err && <p className="li-error">{err}</p>}
        <button className="li-btn primary">Unlock</button>
      </form>
    </div>
  );
}
