import { describe, expect, it } from 'vitest';
import {
  MAX_SAVED_FILE_CHARS,
  ago,
  clearAllChats,
  deleteChat,
  listChats,
  loadChat,
  MAX_CHATS,
  MAX_MESSAGES,
  MAX_TITLE,
  renameChat,
  saveChat,
  searchChats,
  titleFor
} from './chatStore.js';

const memory = (limit = Infinity) => {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (v.length > limit) throw new Error('quota');
      data.set(k, v);
    },
    data
  };
};
const convo = (q, a = 'answer') => [
  { role: 'user', content: q },
  { role: 'assistant', content: a, tools: [{ name: 'rank_teams', args: { x: 1 } }] }
];

describe('titles', () => {
  it('uses the first question, shortened', () => {
    expect(titleFor(convo('Who are the top 5 scorers?'))).toBe('Who are the top 5 scorers?');
    expect(titleFor(convo('x'.repeat(100))).length).toBe(60);
    expect(titleFor(convo('x'.repeat(100))).endsWith('…')).toBe(true);
    expect(titleFor([])).toBe('New chat');
  });
});

describe('saving and loading', () => {
  it('saves a chat, lists it newest first, and loads it back', () => {
    const s = memory();
    saveChat(s, 'u1', { id: 'a', messages: convo('first'), now: 1000 });
    saveChat(s, 'u1', { id: 'b', messages: convo('second'), now: 2000 });
    expect(listChats(s, 'u1').map((c) => c.id)).toEqual(['b', 'a']);
    const loaded = loadChat(s, 'u1', 'a');
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.messages[1].tools).toEqual([{ name: 'rank_teams' }]); // only the tool names are kept
  });
  it('updating a chat moves it to the top and replaces its messages', () => {
    const s = memory();
    saveChat(s, 'u1', { id: 'a', messages: convo('first'), now: 1000 });
    saveChat(s, 'u1', { id: 'b', messages: convo('second'), now: 2000 });
    saveChat(s, 'u1', { id: 'a', messages: [...convo('first'), { role: 'user', content: 'more' }], now: 3000 });
    const list = listChats(s, 'u1');
    expect(list.map((c) => c.id)).toEqual(['a', 'b']);
    expect(list[0].count).toBe(3);
  });
  it("keeps each user's chats separate", () => {
    const s = memory();
    saveChat(s, 'u1', { id: 'a', messages: convo('mine') });
    expect(listChats(s, 'u2')).toEqual([]);
    expect(loadChat(s, 'u2', 'a')).toBeNull();
  });
  it('does not save an empty chat or one with no user message', () => {
    const s = memory();
    expect(saveChat(s, 'u1', { id: 'a', messages: [] })).toBeNull();
    expect(saveChat(s, 'u1', { id: 'a', messages: [{ role: 'assistant', content: 'hi' }] })).toBeNull();
    expect(saveChat(s, 'u1', { id: '', messages: convo('q') })).toBeNull();
    expect(listChats(s, 'u1')).toEqual([]);
  });
  it('caps the number of chats and messages', () => {
    const s = memory();
    for (let i = 0; i < MAX_CHATS + 5; i += 1) saveChat(s, 'u1', { id: `c${i}`, messages: convo(`q${i}`), now: i });
    expect(listChats(s, 'u1')).toHaveLength(MAX_CHATS);
    expect(listChats(s, 'u1')[0].id).toBe(`c${MAX_CHATS + 4}`);
    const long = Array.from({ length: MAX_MESSAGES + 20 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      content: `m${i}`
    }));
    saveChat(s, 'u1', { id: 'long', messages: long });
    expect(loadChat(s, 'u1', 'long').messages).toHaveLength(MAX_MESSAGES);
  });
});

describe('files and proposed actions in saved chats', () => {
  const withExtras = (extra) => [
    { role: 'user', content: 'export it' },
    { role: 'assistant', content: 'here', ...extra }
  ];
  it('keeps small files, drops the content of big ones, and keeps the details of both', () => {
    const s = memory();
    saveChat(s, 'u1', {
      id: 'a',
      messages: withExtras({
        files: [
          { filename: 'small.csv', rows: 2, content: 'a,b\n1,2' },
          { filename: 'big.csv', rows: 9, content: 'x'.repeat(MAX_SAVED_FILE_CHARS + 1) }
        ]
      })
    });
    const [small, big] = loadChat(s, 'u1', 'a').messages[1].files;
    expect(small).toMatchObject({ filename: 'small.csv', rows: 2, content: 'a,b\n1,2' });
    expect(big).toMatchObject({ filename: 'big.csv', rows: 9, content: null });
    expect(big.bytes).toBe(MAX_SAVED_FILE_CHARS + 1);
  });
  it('keeps proposals with their outcome, and a run that never finished comes back as waiting', () => {
    const s = memory();
    const proposal = (id, status, message) => ({
      id,
      kind: 'picklist_add',
      summary: 'Add team 118',
      requests: [{ method: 'POST', path: '/api/scouting-picklist', body: {} }],
      status,
      message
    });
    saveChat(s, 'u1', {
      id: 'a',
      messages: withExtras({
        proposals: [
          proposal('p1', 'done', 'Added'),
          proposal('p2', 'running'),
          proposal('p3', 'failed', 'Already on the pick list')
        ]
      })
    });
    const saved = loadChat(s, 'u1', 'a').messages[1].proposals;
    expect(saved.map((p) => p.status)).toEqual(['done', 'pending', 'failed']);
    expect(saved[2].message).toBe('Already on the pick list');
    expect(saved[0].requests[0].path).toBe('/api/scouting-picklist');
  });
});

describe('renaming', () => {
  it('renames a chat and keeps the name when more messages are added', () => {
    const s = memory();
    saveChat(s, 'u1', { id: 'a', messages: convo('first question'), now: 1000 });
    expect(renameChat(s, 'u1', 'a', '  Auto   scouting plan ')).toBe('Auto scouting plan');
    expect(listChats(s, 'u1')[0].title).toBe('Auto scouting plan');
    saveChat(s, 'u1', {
      id: 'a',
      messages: [...convo('first question'), { role: 'user', content: 'another' }],
      now: 2000
    });
    expect(listChats(s, 'u1')[0].title).toBe('Auto scouting plan');
    expect(loadChat(s, 'u1', 'a').messages).toHaveLength(3);
  });
  it('a blank name restores the automatic title, which then follows the first question again', () => {
    const s = memory();
    saveChat(s, 'u1', { id: 'a', messages: convo('first question'), now: 1000 });
    renameChat(s, 'u1', 'a', 'Custom');
    expect(renameChat(s, 'u1', 'a', '   ')).toBe('first question');
    expect(listChats(s, 'u1')[0].title).toBe('first question');
  });
  it('limits the length, ignores a missing chat, and keeps other users separate', () => {
    const s = memory();
    saveChat(s, 'u1', { id: 'a', messages: convo('q') });
    expect(renameChat(s, 'u1', 'a', 'x'.repeat(200)).length).toBe(MAX_TITLE);
    expect(renameChat(s, 'u1', 'missing', 'x')).toBeNull();
    expect(renameChat(s, 'u2', 'a', 'x')).toBeNull();
  });
  it('search finds a chat by its new name', () => {
    const s = memory();
    saveChat(s, 'u1', { id: 'a', messages: convo('first') });
    renameChat(s, 'u1', 'a', 'Playoff picks');
    expect(searchChats(listChats(s, 'u1'), 'playoff').map((c) => c.id)).toEqual(['a']);
  });
});

describe('deleting', () => {
  it('removes one chat and reports whether anything was removed', () => {
    const s = memory();
    saveChat(s, 'u1', { id: 'a', messages: convo('x') });
    saveChat(s, 'u1', { id: 'b', messages: convo('y') });
    expect(deleteChat(s, 'u1', 'a')).toBe(true);
    expect(listChats(s, 'u1').map((c) => c.id)).toEqual(['b']);
    expect(deleteChat(s, 'u1', 'nope')).toBe(false);
  });

  it('clears all saved chats across users on clearAllChats', () => {
    const s = memory();
    saveChat(s, 'u1', { id: 'a', messages: convo('secret strategy') });
    saveChat(s, 'u2', { id: 'b', messages: convo('other user') });
    clearAllChats(s);
    expect(listChats(s, 'u1')).toEqual([]);
    expect(listChats(s, 'u2')).toEqual([]);
  });
});

describe('resilience', () => {
  it('treats corrupt, old-version or missing storage as empty', () => {
    const s = memory();
    s.setItem('scouting-ai-chats:u1', '{not json');
    expect(listChats(s, 'u1')).toEqual([]);
    s.setItem('scouting-ai-chats:u1', JSON.stringify({ v: 99, chats: [{ id: 'a', messages: [] }] }));
    expect(listChats(s, 'u1')).toEqual([]);
    expect(listChats(null, 'u1')).toEqual([]);
    expect(listChats(s, null)).toEqual([]);
    expect(saveChat(null, 'u1', { id: 'a', messages: convo('q') })).toBeNull();
  });
  it('survives storage that throws on read', () => {
    expect(
      listChats(
        {
          getItem: () => {
            throw new Error('blocked');
          },
          setItem: () => {}
        },
        'u1'
      )
    ).toEqual([]);
  });
  it('drops the oldest chats to fit when storage is full, keeping the newest', () => {
    const s = memory(900);
    for (let i = 0; i < 6; i += 1)
      saveChat(s, 'u1', { id: `c${i}`, messages: convo(`question ${i}`, 'a'.repeat(120)), now: i });
    const ids = listChats(s, 'u1').map((c) => c.id);
    expect(ids[0]).toBe('c5');
    expect(ids.length).toBeLessThan(6);
  });
});

describe('search and time', () => {
  const chats = [
    { id: 'a', title: 'Top scorers at the event' },
    { id: 'b', title: 'Compare 5940 and 254' },
    { id: 'c', title: 'Pit problems' }
  ];
  it('matches every word, ignoring case, and returns all for an empty query', () => {
    expect(searchChats(chats, 'SCORERS top').map((c) => c.id)).toEqual(['a']);
    expect(searchChats(chats, '5940').map((c) => c.id)).toEqual(['b']);
    expect(searchChats(chats, 'zzz')).toEqual([]);
    expect(searchChats(chats, '  ')).toHaveLength(3);
    expect(searchChats(chats, null)).toHaveLength(3);
  });
  it('describes how long ago', () => {
    const now = 1_000_000_000_000;
    expect(ago(now - 10_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(ago(now - 26 * 3_600_000, now)).toBe('yesterday');
    expect(ago(now - 3 * 86_400_000, now)).toBe('3 days ago');
    expect(ago(now + 5000, now)).toBe('just now');
    expect(ago(now + 600_000, now)).toBe('');
    expect(ago(NaN, now)).toBe('');
  });
});
