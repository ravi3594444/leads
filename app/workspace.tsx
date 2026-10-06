"use client";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, RotateCw } from "lucide-react";
import { api } from "../lib/client";
import AuthScreen from "../components/auth-screen";
import Dashboard from "../components/dashboard";
import { Brand, Spinner } from "../components/ui";
type Access = { unlocked: boolean };
export default function Workspace() {
  const [access, setAccess] = useState<Access | null>(null), [error, setError] = useState(""), [theme, setTheme] = useState("light");
  const check = useCallback(async () => { setError(""); try { setAccess(await api<Access>("/api/auth/status")); } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); } }, []);
  useEffect(() => { check(); let saved = "light"; try { saved = localStorage.getItem("permitline-theme") || "light"; } catch {} setTheme(saved === "dark" ? "dark" : "light"); }, [check]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem("permitline-theme", theme); } catch {} }, [theme]);
  useEffect(() => { const lock = () => setAccess({ unlocked: false }); window.addEventListener("permitline:locked", lock); return () => window.removeEventListener("permitline:locked", lock); }, []);
  const toggleTheme = () => setTheme(value => value === "light" ? "dark" : "light");
  if (error && !access) return <main className="loading-screen"><Brand/><div className="loading-message"><h1>Let's reconnect.</h1><p>{error}</p><button className="button button-primary" onClick={check}><RotateCw size={17}/>Try again</button></div></main>;
  if (!access) return <main className="loading-screen"><Brand/><div className="loading-message"><Spinner/><p>Opening your workspace</p></div></main>;
  if (!access.unlocked) return <AuthScreen theme={theme} toggleTheme={toggleTheme} onUnlocked={check}/>;
  return <Dashboard theme={theme} toggleTheme={toggleTheme} onLocked={() => setAccess({ unlocked: false })}/>;
}
