# Instagram Publisher

The live Instagram browser publisher is implemented in `../queue-runner/server/services/publishers/instagram.ts` and orchestrated by the shared Publish Queue Runner.

The composer transition supports both Instagram layouts: Create may open the post composer directly, or it may open the Create menu, where the runner explicitly selects **Post** before uploading media.

Planned service type: publishing.
