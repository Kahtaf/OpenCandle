export function filterSessions(sessions, query) {
  const needle = normalizeSearch(query);
  if (!needle) return sessions;
  return sessions.filter((session) => sessionMatches(session, needle));
}

function sessionMatches(session, needle) {
  return [session.name, session.firstMessage, session.allMessagesText, session.id].some((value) =>
    normalizeSearch(value).includes(needle),
  );
}

function normalizeSearch(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}
