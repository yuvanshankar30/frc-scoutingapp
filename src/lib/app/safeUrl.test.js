import { describe, expect, it } from 'vitest';
import { safeExternalHttpUrl, safeInternalPath, safeUrl } from './safeUrl.js';

describe('safeUrl / safeExternalHttpUrl (XSS-01)', () => {
  it('allows valid http and https URLs', () => {
    expect(safeUrl('https://www.thebluealliance.com/team/5940')).toBe('https://www.thebluealliance.com/team/5940');
    expect(safeUrl('  http://example.org/  ')).toBe('http://example.org/');
    expect(safeExternalHttpUrl('https://www.youtube.com/watch?v=MBEj_crYoBA')).toBe(
      'https://www.youtube.com/watch?v=MBEj_crYoBA'
    );
  });

  it('rejects javascript:, data:, vbscript:, file:, and malformed URLs', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(document.cookie)',
      '  javascript:fetch("/api/vision")',
      'jav\tascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '//evil.example/xss',
      '/relative/path',
      '',
      null,
      undefined
    ]) {
      expect(safeUrl(bad)).toBe('');
    }
  });
});

describe('safeInternalPath (XSS-04)', () => {
  it('allows same-origin paths with query strings and hashes', () => {
    expect(safeInternalPath('/scouting/vision?event_key=2026cc#auto')).toBe('/scouting/vision?event_key=2026cc#auto');
    expect(safeInternalPath('/teamview?team=5940', '')).toBe('/teamview?team=5940');
    expect(safeInternalPath('/')).toBe('/');
  });

  it('rejects backslash authority bypasses (/\\host), scheme-relative URLs (//host), and external URLs', () => {
    for (const bad of [
      '/\\evil.example',
      '/\\evil.example/login',
      '/foo\\bar',
      '//evil.example',
      '///evil.example',
      'https://evil.example/phish',
      'javascript:alert(1)',
      '/\t/evil.example',
      '',
      null,
      undefined
    ]) {
      expect(safeInternalPath(bad, '/')).toBe('/');
      expect(safeInternalPath(bad, '')).toBe('');
    }
  });

  it('uses safeUrl / safeInternalPath in the login, bluealliance, and teamview pages and removes PUBLIC_TBA_API_KEY / VITE_TBA_API_KEY fallbacks in /api/tba/*', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    expect(fs.readFileSync('src/routes/login/+page.svelte', 'utf8')).toContain(
      'safeInternalPath($page.url.searchParams'
    );
    expect(fs.readFileSync('src/routes/bluealliance/+page.svelte', 'utf8')).toContain('safeUrl(teamProfile.website)');
    const teamview = fs.readFileSync('src/routes/teamview/+page.svelte', 'utf8');
    expect(teamview).toContain('safeUrl(tbaPhoto.view_url)');
    expect(teamview).toContain('safeInternalPath(requestedReturnTo');

    const tbaDir = 'src/routes/api/tba';
    for (const sub of fs.readdirSync(tbaDir)) {
      const serverFile = path.join(tbaDir, sub, '+server.js');
      if (fs.existsSync(serverFile)) {
        const src = fs.readFileSync(serverFile, 'utf8');
        expect(src).not.toContain('PUBLIC_TBA_API_KEY');
        expect(src).not.toContain('VITE_TBA_API_KEY');
      }
    }

    const friendsSrc = fs.readFileSync('src/routes/api/prediction-market-v2/friends/+server.js', 'utf8');
    expect(friendsSrc).toContain('UUID_RE.test(String(actor.id');
    expect(friendsSrc).toContain('UUID_RE.test(friendId)');

    const botSrc = fs.readFileSync('src/lib/server/integrations/slack.js', 'utf8');
    expect(botSrc).not.toContain('env.BOT_TOKEN');
    expect(botSrc).not.toContain('env.TOKEN');
    expect(fs.readFileSync('src/lib/server/serviceClient.js', 'utf8')).toContain('persistSession: false');

    const envExample = fs.readFileSync('.env.example', 'utf8');
    expect(envExample).toContain('SUPABASE_URL=');
    expect(envExample).toContain('CRON_SECRET=');
    expect(envExample).toContain('GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY=');
    expect(envExample).toContain('SUPABASE_SERVICE_KEY=');
  });
});
