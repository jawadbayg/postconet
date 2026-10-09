import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/index.css";
import "./monaco";

const root = document.getElementById("root");
if (!root) {
  document.body.textContent = "PostConet failed to start: missing root element.";
} else {
  try {
    createRoot(root).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    root.textContent = `PostConet failed to start: ${error instanceof Error ? error.message : String(error)}`;
  }
}
