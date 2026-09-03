// Filled in by shell/build.sh when compiling a binary; these defaults are what
// a source checkout sees.
//
// A compiled binary has no .git to read its commit from, and its --allow-run
// allowlist is fixed at compile time — so the path it will look for desk.sh at
// has to be decided when the binary is made, not when it runs. Both facts get
// written here rather than guessed at runtime.
export const COMMIT = "";
export const SCRIPTS_DIR = "";
