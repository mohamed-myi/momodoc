"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Dashboard } from "./Dashboard";
import { ProjectView } from "./ProjectView";
import { SettingsPanel } from "./SettingsPanel";

type View = "dashboard" | "project" | "settings";

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [projectId, setProjectId] = useState<string | null>(null);

  const handleSelectProject = (id: string) => {
    setProjectId(id);
    setView("project");
  };

  const handleBack = () => {
    setView("dashboard");
    setProjectId(null);
  };

  if (view === "settings") {
    return <SettingsPanel onBack={handleBack} api={api} />;
  }

  if (view === "project" && projectId) {
    return <ProjectView projectId={projectId} onBack={handleBack} />;
  }

  return (
    <Dashboard
      onSelectProject={handleSelectProject}
      onOpenSettings={() => setView("settings")}
    />
  );
}
