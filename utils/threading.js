// utils/threading.js
export function computeThreadKey({ inReplyTo, references, plusToken, subject, providerMessageId }) {
  const refTail =
    Array.isArray(references) && references.length
      ? references[references.length - 1]
      : (typeof references === "string" ? references : null);
  return inReplyTo || refTail || plusToken || (subject ? `subj:${subject}` : `msg:${providerMessageId}`);
}
