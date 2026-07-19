process.env.PIDEX_ADAPTERS ??= "deterministic";
process.env.PIDEX_DATA_DIR ??= ".pidex-data-dev";

await import("./main.js");
