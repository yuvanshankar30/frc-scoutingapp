# Scouting Admin: Event setup

The active event, prescouting teams, the match-data Google Sheet and starting-position photos. A competition code is
created here and can follow a different TBA event.

## Tracked TBA event

A competition code can follow a different TBA event (`scouting_events.tba_event_key`), for example a practice code that
uses the real event's schedule. Every TBA lookup for the code (the `/api/tba/event-*` proxies, match teams, the admin
dashboard and the assistant) asks TBA about the tracked event, and match keys come back renamed to
the code so reports still line up (`src/lib/server/scouting/tbaEventLink.js`). The event is picked with a search where
Gemini matches what was typed (nicknames work) against TBA's event list for the season, falling back to text matching;
the link is optional (without `GEMINI_API_KEY` only text matching is used). API: `/api/scouting-event-link`.

