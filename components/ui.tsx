"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { Check, CircleAlert, X } from "lucide-react";
export function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? "brand-small" : ""}`}><svg width="25" height="34" viewBox="0 0 25 34" fill="none" aria-hidden="true"><path d="M12.5 1v20M8.5 12h8v7h-8z" stroke="currentColor" strokeWidth="1.8"/><path d="M5 23h15l-7.5 10z" fill="currentColor"/></svg><span>Permitline</span></span>;
}
export function Spinner({ small = false }: { small?: boolean }) { return <span className={`spinner ${small ? "spinner-small" : ""}`} aria-hidden="true" />; }
export interface ToastMessage { message: string; error?: boolean; id: number }
export function Toast({ toast, onClose }: { toast: ToastMessage | null; onClose: () => void }) {
  useEffect(() => { if (!toast) return; const timer = setTimeout(onClose, 5500); return () => clearTimeout(timer); }, [toast, onClose]);
  if (!toast) return null;
  return <div className={`toast ${toast.error ? "toast-error" : ""}`} role={toast.error ? "alert" : "status"}>{toast.error ? <CircleAlert size={19}/> : <Check size={19}/>}<span>{toast.message}</span><button className="icon-button" onClick={onClose} aria-label="Dismiss notification"><X size={16}/></button></div>;
}
export function Dialog({ open, onClose, title, children, drawer = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; drawer?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = ref.current; if (!node) return; if (open && !node.open) node.showModal(); if (!open && node.open) node.close(); }, [open]);
  return <dialog ref={ref} className={drawer ? "drawer" : "modal"} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}><div className="dialog-content"><header className="dialog-header"><span>{title}</span><button className="icon-button" onClick={onClose} aria-label={`Close ${title}`}><X size={21}/></button></header>{children}</div></dialog>;
}
export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
