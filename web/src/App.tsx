import { useCallback, useEffect, useState } from "react";
import { api, isMock } from "./api/index.js";
import type { Capabilities } from "./api/types.js";
import { CapsContext } from "./caps.js";
import { Header } from "./components.js";
import { errorText, useRoute } from "./lib.js";
import { NewProject } from "./screens/NewProject.js";
import { Start } from "./screens/Start.js";
import { Workspace } from "./screens/Workspace.js";

export function App() {
  const route = useRoute();
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true); // the first check starts on mount

  const load = useCallback(() => {
    api
      .capabilities()
      .then((c) => {
        setCaps(c);
        setError("");
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setChecking(false));
  }, []);
  const recheck = useCallback(() => {
    setChecking(true);
    load();
  }, [load]);
  useEffect(load, [load]);

  return (
    <CapsContext.Provider value={{ caps, error, checking, recheck }}>
      <Header />
      {isMock && <div className="mock-bar">Mock mode: no server, nothing is real.</div>}
      <main>
        {route.name === "start" && <Start />}
        {route.name === "new" && <NewProject preset={route.preset} />}
        {route.name === "project" && <Workspace key={route.id} id={route.id} />}
      </main>
    </CapsContext.Provider>
  );
}
