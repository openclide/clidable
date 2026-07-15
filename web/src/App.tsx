import { useState } from "react";
import { WelcomeScreen } from "./components/welcome/WelcomeScreen";
import { WorkspaceScreen } from "./components/workspace/WorkspaceScreen";
import type { AgentId, MockProject } from "./components/welcome/data";
import { touchProject } from "./lib/projects-client";

type View =
  | { kind: "welcome" }
  | { kind: "workspace"; project: MockProject; agentId: AgentId };

export function App() {
  const [view, setView] = useState<View>({ kind: "welcome" });

  if (view.kind === "workspace") {
    return (
      <WorkspaceScreen
        project={view.project}
        agentId={view.agentId}
        onBack={() => setView({ kind: "welcome" })}
      />
    );
  }

  return (
    <WelcomeScreen
      onOpenProject={(project, agentId) => {
        // Bump last_opened + record which agent this project launched with,
        // so the recents list re-ranks and reopens with the same agent.
        void touchProject(project.id, agentId).catch((e) =>
          console.error("[app] touchProject failed", e),
        );
        setView({ kind: "workspace", project, agentId });
      }}
    />
  );
}
