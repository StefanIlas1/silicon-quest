import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import FocusProvider from "./FocusProvider";
import ReviewProvider from "./ReviewProvider";
import RestoreBoundary from "./RestoreBoundary";
import ProjectProvider from "./ProjectProvider";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RestoreBoundary>
      <ProjectProvider>
        <ReviewProvider>
          <FocusProvider>
            <App />
          </FocusProvider>
        </ReviewProvider>
      </ProjectProvider>
    </RestoreBoundary>
  </React.StrictMode>,
);
