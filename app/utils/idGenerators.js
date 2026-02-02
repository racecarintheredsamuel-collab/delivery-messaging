// ============================================================================
// ID GENERATORS
// Generate unique IDs for rules and profiles
// ============================================================================

export function newRuleId() {
  return globalThis.crypto?.randomUUID?.() ?? `rule-${Date.now()}`;
}

export function newProfileId() {
  return globalThis.crypto?.randomUUID?.() ?? `profile-${Date.now()}`;
}
