# Offline

Event venues have bad Wi-Fi. Schedule, roster, assignment and OPR responses are cached in the browser
(`fetchWithCache`), and scouting submissions made offline are queued and sent when the connection returns. Pages that
poll stop polling while their tab is hidden, which also cuts Supabase egress.

A report saved offline is checked the same way as an online one (for example the match box must hold a readable match
number), so the queue can't carry something the server will refuse.
