/**
 * 전역 상태 — 간단한 pub/sub 스토어
 *
 * store.set('user', u)  → 값 변경 + 구독자에게 알림
 * store.on('user', fn)  → 값 바뀔 때마다 fn 호출
 * store.get('user')     → 현재 값 조회
 */

import type { User } from '@supabase/supabase-js';

export interface StoreState {
  user: User | null;
  authChecked: boolean; // Supabase가 세션 확인을 끝냈는지 여부
}

type Key = keyof StoreState;
type Listener<K extends Key> = (value: StoreState[K]) => void;

const state: StoreState = {
  user: null,
  authChecked: false,
};

const listeners: { [K in Key]?: Set<Listener<K>> } = {};

export const store = {
  get<K extends Key>(key: K): StoreState[K] {
    return state[key];
  },

  set<K extends Key>(key: K, value: StoreState[K]): void {
    state[key] = value;
    listeners[key]?.forEach((fn) => fn(value));
  },

  on<K extends Key>(key: K, fn: Listener<K>): void {
    if (!listeners[key]) listeners[key] = new Set();
    (listeners[key] as Set<Listener<K>>).add(fn);
  },
};
