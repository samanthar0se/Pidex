import React from "react";
import { createRoot } from "react-dom/client";
import { store } from "./client-instance.js";
import { App } from "./App.js";
import "./style.css";
import { clientEnvironment } from "./environment-instance.js";

createRoot(document.getElementById("root")!).render(<React.StrictMode><App/></React.StrictMode>);
if (navigator.serviceWorker) {
  let initialController = navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!initialController) { initialController = navigator.serviceWorker.controller; return; }
    void clientEnvironment.settle().then(
      () => location.reload(),
      () => store.getState().authorityChanged({
        status: "update-required", reason: "Local writes could not settle safely before reload",
      }),
    );
  });
  void navigator.serviceWorker.register("/service-worker.js");
}
