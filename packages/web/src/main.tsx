/**
 * Surakkha web — entry point.
 *
 * Real implementation lands in Story 1.2a (Design Tokens + Density) and
 * Story 1.3 (Login Shell). This stub mounts a single page so the Vite
 * build produces a valid SPA and Docker Compose can serve it.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Root element #root not found in index.html");
}

createRoot(root).render(
  <StrictMode>
    <main>
      <h1>Surakkha</h1>
      <p>Story 1.3 will replace this with the login shell.</p>
    </main>
  </StrictMode>,
);
