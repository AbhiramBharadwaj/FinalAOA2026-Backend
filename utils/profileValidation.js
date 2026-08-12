const BLOCKED_PLACEHOLDER_NAMES = new Set(['test', 'dummy', 'sample']);

export const isBlockedPlaceholderName = (name) =>
  BLOCKED_PLACEHOLDER_NAMES.has(String(name || '').trim().toLowerCase());

export const validateAttendeeName = (name) => {
  if (isBlockedPlaceholderName(name)) {
    return 'Please enter the attendee’s real full name. Test, Dummy, and Sample are not accepted.';
  }
  return null;
};
