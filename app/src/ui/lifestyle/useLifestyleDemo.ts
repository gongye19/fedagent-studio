import { useEffect, useReducer, useState } from "react";
import { parseDemoSession, reduceDemo } from "../../domain/lifestyle/simulation";

export const LIFESTYLE_DEMO_KEY = "fedagent:lifestyle-demo:v1";

export function useLifestyleDemo() {
  const [storageError,setStorageError] = useState(false);
  const [session,dispatch] = useReducer(reduceDemo, undefined, () => {
    try { return parseDemoSession(localStorage.getItem(LIFESTYLE_DEMO_KEY)); }
    catch { return parseDemoSession(null); }
  });
  useEffect(() => {
    try { localStorage.setItem(LIFESTYLE_DEMO_KEY,JSON.stringify(session)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [session]);
  return {session,dispatch,storageError};
}
