import React from "react";
import { createRoot } from "react-dom/client";
import { store } from "./client-instance.js";
import { App } from "./App.js";
import "./style.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
void navigator.serviceWorker?.register("/service-worker.js");
