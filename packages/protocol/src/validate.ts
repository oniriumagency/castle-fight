/**
 * Runtime checks shared by the server (which never trusts what it receives)
 * and the client (which can validate a nickname before sending it).
 */
import { isHeroId, type PlayerId } from '@cardcraft-castles/engine';
import {
  EMOTES,
  LIMITS,
  ROOM_ID_PATTERN,
  ROOM_SIZES,
  TURN_SECONDS_OPTIONS,
  type ActionIntent,
  type Emote,
  type HeroChoice,
  type RoomClientMessage,
} from './index';
import { RANKED_ID_PATTERN, type RankedClientMessage } from './ranked';

/**
 * Normalise user-typed text: drops control and invisible characters, caps
 * stacked accents (Zalgo), collapses whitespace and cuts to `max` characters
 * (by code point, so emoji are never split in half).
 */
export function cleanText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  const text = raw
    .slice(0, max * 8)
    .normalize('NFKC')
    // Control, format (zero-width, bidi overrides), private use, unassigned and line separators.
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/gu, '')
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, max).join('').trim();
}

/** A clean nickname, or `null` when nothing usable is left. */
export function cleanNickname(raw: unknown): string | null {
  return cleanText(raw, LIMITS.nicknameMax) || null;
}

export function cleanRoomName(raw: unknown): string | null {
  return cleanText(raw, LIMITS.roomNameMax) || null;
}

/** A public player id: 24 lowercase hex characters. */
export function isPlayerId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);
}

export function isRoomId(value: unknown): value is string {
  return typeof value === 'string' && ROOM_ID_PATTERN.test(value);
}

export function isEmote(value: unknown): value is Emote {
  return typeof value === 'string' && (EMOTES as readonly string[]).includes(value);
}

export function isHeroChoice(value: unknown): value is HeroChoice {
  return value === 'random' || (typeof value === 'string' && isHeroId(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUid(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** A player intention with only the fields the server reads, or `null`. */
export function parseActionIntent(raw: unknown): ActionIntent | null {
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case 'play':
      return isUid(raw.uid) ? { type: 'play', uid: raw.uid } : null;
    case 'discard': {
      if (!isUid(raw.uid)) return null;
      if (raw.also === undefined) return { type: 'discard', uid: raw.uid };
      // The engine checks the total against its rules; this only bounds the message.
      if (!Array.isArray(raw.also) || raw.also.length > 8 || !raw.also.every(isUid)) return null;
      return { type: 'discard', uid: raw.uid, also: raw.also.slice() };
    }
    case 'ultimate':
    case 'endTurn':
    case 'concede':
      return { type: raw.type };
    case 'choose':
      return typeof raw.option === 'string' && raw.option.length <= 64 ? { type: 'choose', option: raw.option } : null;
    default:
      return null;
  }
}

/**
 * Parse one room message from the wire. Unknown fields are dropped, so what
 * comes out is exactly the typed message. Returns `null` for anything else.
 */
export function parseRoomClientMessage(text: string): RoomClientMessage | null {
  if (text.length > LIMITS.messageBytes) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case 'join':
      if (typeof raw.v !== 'number' || typeof raw.nickname !== 'string' || !isHeroChoice(raw.hero)) return null;
      if (raw.pid !== undefined && !isPlayerId(raw.pid)) return null;
      if (raw.ticket !== undefined && (typeof raw.ticket !== 'string' || raw.ticket.length > 64)) return null;
      return {
        type: 'join',
        v: raw.v,
        nickname: raw.nickname,
        hero: raw.hero,
        ...(raw.pid === undefined ? {} : { pid: raw.pid }),
        ...(raw.ticket === undefined ? {} : { ticket: raw.ticket as string }),
      };
    case 'resume':
      if (typeof raw.v !== 'number' || typeof raw.token !== 'string' || raw.token.length > 64) return null;
      return { type: 'resume', v: raw.v, token: raw.token };
    case 'action': {
      const action = parseActionIntent(raw.action);
      return action ? { type: 'action', action } : null;
    }
    case 'rematch':
      if (raw.hero !== undefined && !isHeroChoice(raw.hero)) return null;
      return raw.hero === undefined ? { type: 'rematch' } : { type: 'rematch', hero: raw.hero };
    case 'emote':
      return isEmote(raw.emote) ? { type: 'emote', emote: raw.emote } : null;
    case 'leave':
    case 'sync':
      return { type: raw.type };
    case 'watch':
      return typeof raw.v === 'number' ? { type: 'watch', v: raw.v } : null;
    default:
      return null;
  }
}

/** The other seat. */
export function otherSeat(seat: PlayerId): PlayerId {
  return seat === 0 ? 1 : 0;
}

/** A room size a host may choose (one of `ROOM_SIZES`); 2 for anything else. */
export function cleanRoomSize(raw: unknown): number {
  return typeof raw === 'number' && (ROOM_SIZES as readonly number[]).includes(raw) ? raw : 2;
}

/** Twilight Fury is on unless the host turned it off explicitly. */
export function cleanTwilight(raw: unknown): boolean {
  return raw !== false;
}

/** A turn length a host may choose (one of `TURN_SECONDS_OPTIONS`), or null. */
export function cleanTurnSeconds(raw: unknown): number | null {
  return typeof raw === 'number' && (TURN_SECONDS_OPTIONS as readonly number[]).includes(raw) ? raw : null;
}

/** Parse one message of the ranked queue, or `null`. Unknown fields are dropped. */
export function parseRankedClientMessage(text: string): RankedClientMessage | null {
  if (text.length > 1024) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const isId = (value: unknown): value is string => typeof value === 'string' && RANKED_ID_PATTERN.test(value);
  switch (raw.type) {
    case 'hello':
      if (typeof raw.v !== 'number') return null;
      if (raw.secret !== null && (typeof raw.secret !== 'string' || raw.secret.length > 64)) return null;
      return { type: 'hello', v: raw.v, secret: raw.secret as string | null };
    case 'search':
      if (typeof raw.nickname !== 'string' || !isHeroChoice(raw.hero)) return null;
      return { type: 'search', nickname: raw.nickname, hero: raw.hero };
    case 'cancel':
    case 'top':
      return { type: raw.type };
    case 'challenge':
      return isId(raw.target) ? { type: 'challenge', target: raw.target } : null;
    case 'answer':
      return isId(raw.from) && typeof raw.accept === 'boolean' ? { type: 'answer', from: raw.from, accept: raw.accept } : null;
    default:
      return null;
  }
}
