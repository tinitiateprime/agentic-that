import {
  DELETE as publishingDelete,
  GET as publishingGet,
  PATCH as publishingPatch,
  POST as publishingPost,
} from "../../publishing/[...path]/route.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request, context) {
  return publishingGet(request, context);
}

export function POST(request, context) {
  return publishingPost(request, context);
}

export function PATCH(request, context) {
  return publishingPatch(request, context);
}

export function DELETE(request, context) {
  return publishingDelete(request, context);
}
