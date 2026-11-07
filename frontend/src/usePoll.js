import { useEffect, useRef } from "react";

// Run `task` now and then every `ms` milliseconds while the page is open.
export function usePoll(task, ms = 3000) {
  const latest = useRef(task);
  latest.current = task;
  useEffect(() => {
    const run = () => latest.current()?.catch?.(() => {});
    run();
    const timer = setInterval(run, ms);
    return () => clearInterval(timer);
  }, [ms]);
}
