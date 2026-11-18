import { describe, expect, it } from 'vitest';
import { LIMITS, PROTOCOL_VERSION, cleanNickname, cleanRoomName, cleanTurnSeconds, isRoomId, parseRoomClientMessage } from '@cardcraft-castles/protocol';
import { roomIdFromUrl } from '@cardcraft-castles/protocol/client';

describe('cleanNickname', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanNickname('  Sir   Lancelot \n')).toBe('Sir Lancelot');
  });

  it('removes invisible, control and bidi characters', () => {
    expect(cleanNickname('A\u200bn\u0000a\u202e')).toBe('Ana');
    expect(cleanNickname('\u200b\u200c\u2060')).toBeNull();
    expect(cleanNickname(42)).toBeNull();
  });

  it('caps stacked accents', () => {
    const zalgo = 'Z' + '\u0301\u0302\u0303\u0304\u0305\u0306';
    // NFKC folds Z + acute into one letter; at most two marks stay on top of it.
    expect(cleanNickname(zalgo)).toBe('\u0179\u0302\u0303');
  });

  it('cuts long names without splitting emoji', () => {
    const name = '🏰'.repeat(30);
    const clean = cleanNickname(name)!;
    expect(Array.from(clean)).toHaveLength(LIMITS.nicknameMax);
    expect(clean).toBe('🏰'.repeat(LIMITS.nicknameMax));
  });

  it('room names follow the same rules with their own length', () => {
    expect(cleanRoomName('x'.repeat(100))).toHaveLength(LIMITS.roomNameMax);
  });
});

describe('cleanTurnSeconds', () => {
  it('accepts only the offered turn lengths', () => {
    expect(cleanTurnSeconds(45)).toBe(45);
    expect(cleanTurnSeconds(90)).toBe(90);
    expect(cleanTurnSeconds(0)).toBe(0);
    expect(cleanTurnSeconds(-1)).toBeNull();
    expect(cleanTurnSeconds(31)).toBeNull();
    expect(cleanTurnSeconds('30')).toBeNull();
    expect(cleanTurnSeconds(1e9)).toBeNull();
    expect(cleanTurnSeconds(undefined)).toBeNull();
  });
});

describe('room ids and invite links', () => {
  it('accepts only the server alphabet', () => {
    expect(isRoomId('abcd2345')).toBe(true);
    expect(isRoomId('abcd0145')).toBe(false);
    expect(isRoomId('ABCD2345')).toBe(false);
    expect(isRoomId('abcd234')).toBe(false);
  });

  it('reads the room from an invite link', () => {
    expect(roomIdFromUrl('https://castles.example/?room=abcd2345')).toBe('abcd2345');
    expect(roomIdFromUrl('https://castles.example/?room=../../x')).toBeNull();
    expect(roomIdFromUrl('not a url')).toBeNull();
  });
});

describe('parseRoomClientMessage', () => {
  it('keeps only the fields the server reads', () => {
    const text = JSON.stringify({ type: 'action', action: { type: 'play', uid: 7, player: 1, extra: true }, x: 1 });
    expect(parseRoomClientMessage(text)).toEqual({ type: 'action', action: { type: 'play', uid: 7 } });
  });

  it('rejects server-only and unknown actions', () => {
    expect(parseRoomClientMessage(JSON.stringify({ type: 'action', action: { type: 'timeout' } }))).toBeNull();
    expect(parseRoomClientMessage(JSON.stringify({ type: 'action', action: { type: 'play', uid: -1 } }))).toBeNull();
    expect(parseRoomClientMessage(JSON.stringify({ type: 'chat', text: 'hola' }))).toBeNull();
  });

  it('checks heroes, emotes and tokens', () => {
    const join = { type: 'join', v: PROTOCOL_VERSION, nickname: 'Ana' };
    expect(parseRoomClientMessage(JSON.stringify({ ...join, hero: 'random' }))).toMatchObject({ hero: 'random' });
    expect(parseRoomClientMessage(JSON.stringify({ ...join, hero: 'arquitecta' }))).toMatchObject({ hero: 'arquitecta' });
    expect(parseRoomClientMessage(JSON.stringify({ ...join, hero: 'batman' }))).toBeNull();
    expect(parseRoomClientMessage(JSON.stringify({ type: 'emote', emote: 'wow' }))).toEqual({ type: 'emote', emote: 'wow' });
    expect(parseRoomClientMessage(JSON.stringify({ type: 'resume', v: 2, token: 'x'.repeat(200) }))).toBeNull();
    expect(parseRoomClientMessage(JSON.stringify({ type: 'rematch', hero: 'batman' }))).toBeNull();
    expect(parseRoomClientMessage(JSON.stringify({ type: 'rematch' }))).toEqual({ type: 'rematch' });
  });

  it('rejects junk and oversized messages', () => {
    expect(parseRoomClientMessage('{')).toBeNull();
    expect(parseRoomClientMessage('[]')).toBeNull();
    expect(parseRoomClientMessage('null')).toBeNull();
    expect(parseRoomClientMessage(JSON.stringify({ type: 'sync', pad: 'x'.repeat(LIMITS.messageBytes) }))).toBeNull();
  });
});
