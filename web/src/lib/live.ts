import { createContext, useContext } from 'react';

export type Tick = {
  at: string;
  system: any;
  ami: any;
  calls: any[];
  counters: { active: number; waiting: number; talking: number };
};

/** Live telemetry shared by the shell, dashboard and channel monitor. */
export const LiveCtx = createContext<{ tick: Tick | null; connected: boolean }>({
  tick: null,
  connected: false
});

export const useLive = () => useContext(LiveCtx);
