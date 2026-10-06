"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole, Moon, Sun, ShieldCheck } from "lucide-react";
import { api } from "../lib/client";
import { Brand, Spinner } from "./ui";

export default function AuthScreen({ theme, toggleTheme, onUnlocked }: { theme: string; toggleTheme: () => void; onUnlocked: () => void }) {
  const [password, setPassword] = useState(""), [show, setShow] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (password.length < 10) { setError("Use at least 10 characters."); return; }
    setBusy(true);
    try { await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }); setPassword(""); onUnlocked(); }
    catch (e) { setError(e instanceof Error ? e.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="auth-page"><header className="auth-header"><Brand/><div className="header-actions"><span className="private-label"><LockKeyhole size={13}/> Private workspace</span><button className="icon-button" onClick={toggleTheme} aria-label={theme === "dark" ? "Use light theme" : "Use black theme"}>{theme === "dark" ? <Sun size={19}/> : <Moon size={19}/>}</button></div></header>
    <main className="auth-main"><section className="auth-intro"><span className="eyebrow"><span className="tiny-square"/> FLORIDA, IN FOCUS</span><h1>A clearer view of<br/>your next project.</h1><p>Recent permits. Relevant opportunities.<br/>One quiet place to organize your work.</p><div className="auth-labels"><span>Find</span><span>Review</span><span>Follow through</span></div><div className="intro-rule"/><span className="auth-bottom-note">Built for contractors. Made to stay simple.</span></section>
      <section className="auth-card" aria-labelledby="auth-title"><span className="lock-symbol"><LockKeyhole size={25} strokeWidth={1.5}/></span><h2 id="auth-title">Welcome back.</h2><p>Enter your password to open your permit workspace.</p>
        <form onSubmit={submit}><label className="field-label" htmlFor="workspace-password">Workspace password</label><div className="password-field"><input id="workspace-password" type={show ? "text" : "password"} autoComplete="current-password" autoFocus minLength={10} maxLength={200} value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required aria-describedby={error ? "auth-error" : undefined}/><button type="button" className="icon-button" onClick={() => setShow(value => !value)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div>
          {error && <p className="form-error" id="auth-error" role="alert">{error}</p>}<button className="button button-primary button-full" disabled={busy} type="submit">{busy ? <Spinner small/> : <>Open workspace<ArrowRight size={17}/></>}</button></form>
        <div className="auth-card-footer"><ShieldCheck size={15}/><span>A private space for your business.</span></div></section></main><footer className="auth-footer"><span>Permitline / Florida</span><span>Less searching. More possibility.</span></footer></div>;
}
