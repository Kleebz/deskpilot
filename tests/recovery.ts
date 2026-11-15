// Terminal recovery now uses an isolated tmux server instead of restarting
// the installed service. App route/draft recovery is covered by spaces-mobile.ts.
await import("./terminal-recovery.ts");
