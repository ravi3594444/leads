"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { api } from "../lib/client";
import AuthScreen from "../components/auth-screen";
import Dashboard from "../components/dashboard";
import { Brand, Spinner } from "../components/ui";
type Access = { unlocked: boolean };
export default function Workspace() {
  const [access, setAccess] = useState<Access | null>(null), [error, setError] = useState(""), [theme, setTheme] = useState("light");
  const pending = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setError(""); setAccess(null);
    try {
      const result = await api<Access>("/api/auth/status", { signal: controller.signal, timeoutMs: 15000 });
      if (typeof result?.unlocked !== "boolean") throw new Error("The workspace couldn't verify your session. Please try again.");
      if (!controller.signal.aborted && pending.current === controller) setAccess(result);
    } catch (e) {
      if (!controller.signal.aborted && pending.current === controller) setError(e instanceof Error ? e.message : "Please try again.");
    }
  }, []);
  useEffect(() => { check(); let saved = "light"; try { saved = localStorage.getItem("permitline-theme") || "light"; } catch {} setTheme(saved === "dark" ? "dark" : "light"); return () => pending.current?.abort(); }, [check]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem("permitline-theme", theme); } catch {} }, [theme]);
  useEffect(() => { const lock = () => setAccess({ unlocked: false }); window.addEventListener("permitline:locked", lock); return () => window.removeEventListener("permitline:locked", lock); }, []);
  const toggleTheme = () => setTheme(value => value === "light" ? "dark" : "light");
  if (error && !access) return <main className="loading-screen"><Brand/><div className="loading-message"><h1>Let's reconnect.</h1><p>{error}</p><button className="button button-primary" onClick={check}><RotateCw size={17}/>Try again</button></div></main>;
  if (!access) return <main className="loading-screen"><Brand/><div className="loading-message"><Spinner/><p>Opening your workspace</p></div></main>;
  if (!access.unlocked) return <AuthScreen theme={theme} toggleTheme={toggleTheme} onUnlocked={check}/>;
  return <Dashboard theme={theme} toggleTheme={toggleTheme} onLocked={() => setAccess({ unlocked: false })}/>;
}
