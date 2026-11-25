// 元件外部的小型狀態：讓 showModal、showToast 這類「在任何地方都能呼叫」的函式，改了狀態後畫面跟著更新。

import { useSyncExternalStore } from 'react';

export interface ExternalStore<Value> {
  get: () => Value;
  set: (next: Value) => void;
  subscribe: (onChange: () => void) => () => void;
}

/** 建立一個狀態；set 之後所有訂閱的畫面都會重新畫。 */
export function createExternalStore<Value>(initial: Value): ExternalStore<Value> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}

/** 在元件裡讀取狀態，狀態改變時重新畫。 */
export function useStoreValue<Value>(store: ExternalStore<Value>): Value {
  return useSyncExternalStore(store.subscribe, store.get);
}
