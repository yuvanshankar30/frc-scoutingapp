#!/usr/bin/env node
// Command-line admin for the scouting app: make the first admin account, set the team settings, approve accounts.
// It uses the server's service key from .env, so run it only where that key already lives (your computer or server).
//
//   npm run admin -- create-admin --email you@example.com --password '...' [--name "Your Name"]
//   npm run admin -- set-team --number 1234 --name "Robo Raptors" [--app-name "..."] [--short-name "..."]
//                             [--color "#dc2626"] [--theme dark|light] [--timezone America/Chicago]
//                             [--other-teams "5678,9012"] [--sign-up on|off] [--hide "assistant,epa"]
//   npm run admin -- show
//   npm run admin -- approve --email someone@example.com
//
// Everything set-team changes can also be changed on the site, in Scouting Admin > Team settings.
import { createClient } from '@supabase/supabase-js';
import { normalizeTeamSettings, validateTeamSettingsInput } from '../src/lib/app/teamSettings.js';
import { isValidTimeZone } from '../src/lib/app/timezone.js';

const USAGE = `Usage:
  npm run admin -- create-admin --email <email> --password <password> [--name <name>]
  npm run admin -- set-team --number <team> --name <team name> [--app-name <name>] [--short-name <name>]
                            [--color <#hex>] [--theme dark|light] [--timezone <IANA zone>]
                            [--other-teams <n,n>] [--sign-up on|off] [--hide <page,page>]
  npm run admin -- show
  npm run admin -- approve --email <email>`;

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const [key, inline] = arg.slice(2).split(/=(.*)/s);
    const value = inline !== undefined ? inline : rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
    options[key] = value;
  }
  return { command, options };
}

function serviceClient(env = process.env) {
  const url = env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Set PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY in .env first.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function findUserByEmail(db, email) {
  const { data, error } = await db.from('user_profiles').select('id, email').ilike('email', email).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function createAdmin(db, { email, password, name }) {
  email = String(email || '')
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('--email must be an email address.');
  const existing = await findUserByEmail(db, email);
  let id = existing?.id;
  if (!id) {
    if (String(password || '').length < 8) throw new Error('--password must be at least 8 characters.');
    const created = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: name || email }
    });
    if (created.error) throw new Error(created.error.message);
    id = created.data.user.id;
  } else if (password) {
    if (String(password).length < 8) throw new Error('--password must be at least 8 characters.');
    const updated = await db.auth.admin.updateUserById(id, { password });
    if (updated.error) throw new Error(updated.error.message);
  }
  const { error } = await db
    .from('user_profiles')
    .update({
      role: 'admin',
      general_role: 'lead',
      permissions: ['CAN_SEE_ROUTES'],
      banned: false,
      ...(name ? { full_name: name } : {})
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
  return { id, email, created: !existing };
}

const list = (value) =>
  String(value || '')
    .split(/[\s,]+/)
    .filter(Boolean);

export async function setTeam(db, options) {
  const { data: row, error: readError } = await db.from('app_settings').select('*').eq('id', 1).maybeSingle();
  if (readError) throw new Error(readError.message);
  const current = normalizeTeamSettings(row || {}) || {};
  const input = {
    teamNumber: options.number ?? current.teamNumber,
    teamName: options.name ?? current.teamName,
    otherTeamNumbers: options['other-teams'] !== undefined ? list(options['other-teams']) : current.otherTeamNumbers,
    appName: options['app-name'] ?? row?.app_name,
    appShortName: options['short-name'] ?? row?.app_short_name,
    brandColor: options.color ?? current.brandColor,
    defaultTheme: options.theme ?? current.defaultTheme,
    timeZone: options.timezone ?? current.timeZone,
    hiddenFeatures: options.hide !== undefined ? list(options.hide) : current.hiddenFeatures,
    allowSignUp: options['sign-up'] !== undefined ? !/^(off|false|no|0)$/i.test(options['sign-up']) : current.allowSignUp
  };
  const { value, error } = validateTeamSettingsInput(input, { isValidTimeZone });
  if (error) throw new Error(error);
  const { error: writeError } = await db
    .from('app_settings')
    .upsert({ id: 1, ...value, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (writeError) throw new Error(writeError.message);
  return value;
}

export async function approve(db, { email }) {
  const user = await findUserByEmail(db, String(email || '').trim());
  if (!user) throw new Error(`No account with the email ${email}.`);
  const { data: profile } = await db.from('user_profiles').select('permissions').eq('id', user.id).maybeSingle();
  const permissions = [...new Set([...(profile?.permissions || []), 'CAN_SEE_ROUTES'])];
  const { error } = await db
    .from('user_profiles')
    .update({ general_role: 'member', permissions, banned: false })
    .eq('id', user.id);
  if (error) throw new Error(error.message);
  return user;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (!command || command === 'help' || options.help) {
    console.log(USAGE);
    return;
  }
  const db = serviceClient();
  if (command === 'create-admin') {
    const result = await createAdmin(db, options);
    console.log(`${result.created ? 'Created' : 'Updated'} admin ${result.email}. Sign in at /login.`);
  } else if (command === 'set-team') {
    const value = await setTeam(db, options);
    console.log(`Team settings saved: team ${value.team_number} (${value.team_name}), app "${value.app_name}".`);
  } else if (command === 'show') {
    const { data, error } = await db.from('app_settings').select('*').eq('id', 1).maybeSingle();
    if (error) throw new Error(error.message);
    console.log(JSON.stringify(data, null, 2));
  } else if (command === 'approve') {
    const user = await approve(db, options);
    console.log(`Approved ${user.email}.`);
  } else {
    throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
