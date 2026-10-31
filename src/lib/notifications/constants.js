// Slack DMs the app can send (all optional, and only when SLACK_BOT_TOKEN is set). Each person can turn any of
// them off; they are on by default.
export const NOTIFICATION_KEYS = {
  SHIFT_ASSIGNMENTS: 'shift_assignments',
  MATCH_REMINDERS: 'match_reminders',
  DATA_CLEANUP: 'data_cleanup'
};

export const DEFAULT_NOTIFICATION_SETTINGS = {
  [NOTIFICATION_KEYS.SHIFT_ASSIGNMENTS]: true,
  [NOTIFICATION_KEYS.MATCH_REMINDERS]: true,
  [NOTIFICATION_KEYS.DATA_CLEANUP]: true
};

export const NOTIFICATION_UI_OPTIONS = [
  {
    key: NOTIFICATION_KEYS.SHIFT_ASSIGNMENTS,
    label: 'Scouting assignments',
    description: 'Direct DM when you are assigned to (or taken off) a scouting shift.'
  },
  {
    key: NOTIFICATION_KEYS.MATCH_REMINDERS,
    label: 'Match reminders',
    description: 'Reminder DM shortly before a match you are scheduled to scout.'
  },
  {
    key: NOTIFICATION_KEYS.DATA_CLEANUP,
    label: 'Data cleanup approvals',
    description: 'Admins only: a DM when old data could be cleaned up to stay under the storage limits.'
  }
];
