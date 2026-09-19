"use client";

import { ProjectWorkspacePage } from "@project-workspace/embedded/react";

export default function AdminProjectManagement({ principal }) {
  return (
    <ProjectWorkspacePage
      apiBasePath="/api/admin-center/project-management"
      storageKey={`agentic-that:admin-project-management:${principal.userId}`}
      canManageRepositories
      className="admin-project-workspace"
    />
  );
}
