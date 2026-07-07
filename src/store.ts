// src/store.ts
/**
 * 전역 상태 — 간단한 pub/sub 스토어
 */

import type { User } from '@supabase/supabase-js';

export interface Trip {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  headcount: number | null;
  theme: string | null;
  destinations: string[] | null;
  [key: string]: unknown;
}

export interface StoreState {
  user: User | null;
  authChecked: boolean;
  currentTrip: Trip | null;
}

type Key = keyof StoreState;
type Listener<K extends Key> = (value: StoreState[K]) => void;

const state: StoreState = {
  user: null,
  authChecked: false,
  currentTrip: null,
};

const listeners = new Map<Key, Set<Listener<any>>>();

export const store = {
  get<K extends Key>(key: K): StoreState[K] {
    return state[key];
  },

  set<K extends Key>(key: K, value: StoreState[K]): void {
    state[key] = value;
    listeners.get(key)?.forEach((fn) => fn(value));
  },

  on<K extends Key>(key: K, fn: Listener<K>): void {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(fn);
  },
};
