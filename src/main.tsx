import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Palette } from "./components/Palette";
import "./styles.css";

async function boot() {
  // Hors application native (navigateur, `npm run dev`) : faux backend en mémoire.
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
    (await import("./dev-mock")).installDevMock();
  }
  // La fenêtre flottante de la palette (⌥⌘P) charge la même page avec `#palette`.
  const isPalette = window.location.hash === "#palette";
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>{isPalette ? <Palette /> : <App />}</React.StrictMode>,
  );
}
void boot();
