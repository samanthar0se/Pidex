import React from "react";
import { createRoot } from "react-dom/client";
import { createClientStore } from "./client-store.js";
import { productionAdapters } from "./adapters.js";
import { App } from "./App.js";
import "./style.css";

export const store = createClientStore(productionAdapters);
createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
void navigator.serviceWorker?.register("/service-worker.js");
