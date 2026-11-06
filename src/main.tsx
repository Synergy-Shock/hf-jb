import React from "react";
import { createRoot } from "react-dom/client";
import "@hyperframes/player";
import App from "./App";
import { registerVfs } from "./vfs";
import "./styles.css";

registerVfs();

createRoot(document.getElementById("app")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
