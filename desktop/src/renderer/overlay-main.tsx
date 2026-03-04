import React from "react";
import ReactDOM from "react-dom/client";
import { OverlayChat } from "./components/new/OverlayChat";
import "./app/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <OverlayChat />
  </React.StrictMode>
);
