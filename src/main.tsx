import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import FocusProvider from "./FocusProvider";
import ReviewProvider from "./ReviewProvider";
import RestoreBoundary from "./RestoreBoundary";
import ProjectProvider from "./ProjectProvider";
import CredentialProvider from "./CredentialProvider";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RestoreBoundary>
      <CredentialProvider>
        <ProjectProvider>
          <ReviewProvider>
            <FocusProvider>
              <App />
            </FocusProvider>
          </ReviewProvider>
        </ProjectProvider>
      </CredentialProvider>
    </RestoreBoundary>
  </React.StrictMode>,
);
