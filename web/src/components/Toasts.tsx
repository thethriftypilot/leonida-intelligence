export interface Toast { id: number; text: string; kind: 'info' | 'success' | 'error' }

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="li-toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`li-toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>{t.text}</div>)}
    </div>
  );
}
