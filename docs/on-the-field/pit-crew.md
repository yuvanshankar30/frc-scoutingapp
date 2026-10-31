# Pit Crew

`/pitcrew` logs your own robot's failures and validates fixes. **Log a failure** takes the subsystem and owner,
severity (match-ending / severe / minor, with a hint), when (date) and where (drive practice or match number), the
short-term fix and minutes, the suspected root cause, and whether it's a repeat; it creates a ticket with
`status = open`. Once a ticket is marked `resolved`, it appears under **Resolved — ready to validate**; **Validate** sets
`status = validated`. Tickets are the `robot_tickets` table. On phones the validation queue comes first and the form
opens in a sheet. The page can be hidden in [Team settings](../scouting-admin/team-settings.md).
