// Meta delivery receipts (webhook `statuses[]`) report a failure only after the
// send call already succeeded, with the reason in `errors[]`. These turn that
// reason into something an admin can act on, and mark it on the chat message
// the same way an immediate send failure is marked ("[send failed: ...]").

const FAILURE_HINTS = {
  131026: "Message undeliverable: the number may not be on WhatsApp, or is written without its country code.",
  131047: "More than 24 hours since this contact last messaged you. Send an approved template instead of free text.",
  131049: "Meta held back this marketing message to protect the user's experience. Try again later, or use a utility template.",
  131042: "Payment problem on the WhatsApp Business account. Add or fix the payment method in Meta Business Manager.",
  131030: "This number is not on the allowed recipients list (test mode).",
  131031: "The WhatsApp Business account is locked or restricted.",
  131050: "The contact has stopped marketing messages from this business.",
  131051: "This message type is not supported.",
  131053: "The media could not be uploaded or sent.",
  132000: "The template's placeholder count does not match the values sent.",
  132001: "The template does not exist in this language, or is not approved.",
  132015: "The template is paused because of low quality.",
  132016: "The template is disabled.",
  130472: "Not delivered: the contact is part of a Meta experiment that limits marketing messages.",
};

export function describeMetaStatusError(errors) {
  const err = Array.isArray(errors) ? errors[0] : null;
  if (!err) return "Meta reported the message as failed without a reason.";
  const code = Number(err.code);
  const detail = err.error_data?.details || err.message || err.title || "";
  const hint = FAILURE_HINTS[code];
  return [code ? `(${code})` : "", hint || detail].filter(Boolean).join(" ");
}

export const SEND_FAILED_MARKER = "[send failed: ";

export function withFailureNote(body, reason) {
  const text = String(body || "");
  if (text.includes(SEND_FAILED_MARKER)) return text; // webhook retries: annotate once
  return `${text}\n\n${SEND_FAILED_MARKER}${reason}]`;
}
