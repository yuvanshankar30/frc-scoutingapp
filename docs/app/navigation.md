# Navigation

The menu groups pages by what someone is doing: **Scout**, **Analyze**, **On the field** and **Scouting Admin**
(admins only), with Home on its own. One list drives the desktop sidebar, the phone bar and the More sheet:
`src/lib/app/navigation.js`. The sidebar shows the team's logo (or number) and app name from
[Team settings](../scouting-admin/team-settings.md), collapses, and its footer has the profile, the light/dark switch
and sign out.

Optional pages (Drive Team, AI analytics, Blue Alliance, EPA) can be hidden in Team settings;
hidden pages leave the menu and the phone bar, and a group with nothing left in it disappears. The phone bar's fourth
button follows the person's competition role (Drive Team or Strategy), falling back to Strategy if that page
is hidden.
