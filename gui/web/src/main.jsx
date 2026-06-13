import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { TooltipProvider } from "./components/ui/tooltip.jsx";
import { router } from "./router.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  </React.StrictMode>,
);
