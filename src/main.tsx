import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import FocusProvider from "./FocusProvider";
import ReviewProvider from "./ReviewProvider";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ReviewProvider>
      <FocusProvider>
        <App />
      </FocusProvider>
    </ReviewProvider>
  </React.StrictMode>,
);
