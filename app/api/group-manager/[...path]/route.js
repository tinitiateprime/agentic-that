import { accessErrorResponse, authorizeOpenServiceApi } from "@platform/server/access-control";
import {
  GroupManagerError,
  addGroupContact,
  addManagedGroupMembers,
  addManagedGroupMessage,
  applyGroupSync,
  createManagedGroup,
  deleteGroupContact,
  deleteManagedGroup,
  groupManagerState,
  removeManagedGroupMember,
  updateGroupContact,
} from "@platform/server/group-manager-store";

export const dynamic = "force-dynamic";

// Group Manager data (Hetzner database), for every signed-in user's workspace:
//   GET    state
//   POST   contacts            PUT/DELETE contacts/:id
//   POST   groups              DELETE groups/:id
//   POST   groups/:id/members  DELETE groups/:id/members/:contactId
//   POST   groups/:id/messages
//   POST   sync                (results the Companion reported to the open page)

async function body(request) {
  return request.json().catch(() => ({}));
}

async function route(request, context) {
  try {
    const actor = await authorizeOpenServiceApi();
    const path = (await context.params).path || [];
    const [area, id, child, childId] = path;
    const method = request.method;

    if (method === "GET" && area === "state" && !id) return Response.json({ ok: true, ...(await groupManagerState(actor)) });

    if (area === "contacts") {
      if (method === "POST" && !id) return Response.json({ ok: true, contact: await addGroupContact(actor, await body(request)) }, { status: 201 });
      if (method === "PUT" && id) return Response.json({ ok: true, contact: await updateGroupContact(actor, id, await body(request)) });
      if (method === "DELETE" && id) {
        await deleteGroupContact(actor, id);
        return Response.json({ ok: true });
      }
    }

    if (area === "groups") {
      if (method === "POST" && !id) return Response.json({ ok: true, group: await createManagedGroup(actor, await body(request)) }, { status: 201 });
      if (method === "DELETE" && id && !child) {
        await deleteManagedGroup(actor, id);
        return Response.json({ ok: true });
      }
      if (child === "members" && method === "POST" && !childId) return Response.json({ ok: true, group: await addManagedGroupMembers(actor, id, await body(request)) });
      if (child === "members" && method === "DELETE" && childId) return Response.json({ ok: true, ...(await removeManagedGroupMember(actor, id, childId)) });
      if (child === "messages" && method === "POST" && !childId) return Response.json({ ok: true, group: await addManagedGroupMessage(actor, id, await body(request)) }, { status: 201 });
    }

    if (area === "sync" && method === "POST" && !id) {
      if (!actor.workspaceId) throw new GroupManagerError("Group Manager needs a workspace.", 409);
      return Response.json({ ok: true, ...(await applyGroupSync(String(actor.workspaceId), await body(request))) });
    }

    return Response.json({ error: "Not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof GroupManagerError) return Response.json({ error: error.message }, { status: error.status });
    if (error?.name === "ZodError") return Response.json({ error: "Those results aren't in the expected format." }, { status: 400 });
    try {
      return accessErrorResponse(error);
    } catch {
      console.error("Group Manager request failed", error);
      return Response.json({ error: "Group Manager couldn't do that. Try again." }, { status: 500 });
    }
  }
}

export const GET = route;
export const POST = route;
export const PUT = route;
export const DELETE = route;
