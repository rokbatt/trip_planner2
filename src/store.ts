/**
 * 전역 상태 관리 — 프레임워크 없는 간단한 pub/sub 스토어
 *
 * 사용법:
 *   store.set('user', userData);
 *   store.on('user', (user) => renderHeader(user));
 *   const user = store.get('user');
 */

import type { User } from '@supabase/supabase-js';
import type { Database } from './types/database';

type Trip = Database['public']['Tables']['trips']['Row'];
type TripMember = Database['public']['Tables']['trip_members']['Row'];

export interface StoreState {
  user: User | null;
  currentTrip: Trip | null;
  members: TripMember[];
  loading: boolean;
  sidebarOpen: boolean;
}

type StoreKey = keyof StoreState;
type Listener<K extends StoreKey> = (value: StoreState[K], prev: StoreState[K]) => void;

const state: StoreState = {
  user: null,
  currentTrip: null,
  members: [],
  loading: true,
  sidebarOpen: false,
};

const listeners = new Map<StoreKey, Set<Listener<any>>>();

export const store = {
  get<K extends StoreKey>(key: K): StoreState[K] {
    return state[key];
  },

  set<K extends StoreKey>(key: K, value: StoreState[K]): void {
    const prev = state[key];
    if (prev === value) return;
    state[key] = value;
    listeners.get(key)?.forEach((fn) => fn(value, prev));
  },

  on<K extends StoreKey>(key: K, fn: Listener<K>): () => void {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(fn);
    // 구독 해제 함수 반환
    return () => listeners.get(key)?.delete(fn);
  },

  /** 한번만 실행되는 리스너 */
  once<K extends StoreKey>(key: K, fn: Listener<K>): void {
    const unsub = this.on(key, (val, prev) => {
      unsub();
      fn(val, prev);
    });
  },
};
