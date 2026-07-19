import process from "node:process";
import {
  currentCase,
  initialState,
  matrixSummary,
  reducePrototype,
  type PrototypeAction,
} from "./model.js";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const green = "\x1b[32m";
const red = "\x1b[31m";
const reset = "\x1b[0m";

let state = initialState();

const render = (): void => {
  const { protocol, cutPoint, image } = currentCase(state);
  const summary = matrixSummary();
  console.clear();
  console.log(`${bold}PROTOTYPE — sudden-power-loss evidence${reset}`);
  console.log(
    `${dim}${summary.protocols} protocols · ${summary.cutPoints} cut points · ${summary.persistenceImages} persistence images · ${summary.releaseBlockingViolations} expected blockers${reset}\n`,
  );
  console.log(`${bold}Protocol${reset}       ${protocol.name}`);
  console.log(`${bold}Promise${reset}        ${protocol.promise}`);
  console.log(
    `${bold}Cut point${reset}      ${cutPoint.name} ${dim}(${cutPoint.acknowledged ? "acknowledged" : "not acknowledged"})${reset}`,
  );
  console.log(`${bold}Disk image${reset}     ${image.name}`);
  console.log(`${bold}On disk${reset}        ${image.disk}`);
  console.log(`${bold}After reboot${reset}   ${image.recovery}\n`);
  console.log(
    `${bold}Verdict${reset}        ${image.allowed ? `${green}ALLOWED${reset}` : `${red}RELEASE BLOCKER${reset}`}`,
  );
  for (const invariant of image.invariants) {
    const status = invariant.passed
      ? `${green}PASS${reset}`
      : `${red}FAIL${reset}`;
    console.log(`  ${status}  ${invariant.name}`);
  }
  console.log(`\n${bold}Required evidence${reset}`);
  console.log(
    `  1. Exhaustive model-oracle result for every protocol × cut point × persistence image.`,
  );
  console.log(
    `  2. Hyper-V hard-off run at every named cut point, followed by a read-only recovery witness.`,
  );
  console.log(
    `  3. Publisher manifest mapping every authoritative path to one protocol and its domain validator.`,
  );
  console.log(
    `  4. First attempt remains authoritative; retries may diagnose but never replace a failure.`,
  );
  console.log(
    `  ${dim}Physical PDU runs characterize named hardware; they do not widen Pidex's support boundary.${reset}`,
  );
  console.log(
    `\n${bold}[←/→]${reset} protocol  ${bold}[↑/↓]${reset} cut point  ${bold}[n/p]${reset} disk image  ${bold}[q]${reset} quit`,
  );
};

const actions: Readonly<Record<string, PrototypeAction>> = {
  "\x1b[D": "previous-protocol",
  "\x1b[C": "next-protocol",
  "\x1b[A": "previous-cut",
  "\x1b[B": "next-cut",
  p: "previous-image",
  n: "next-image",
};

if (!process.stdin.isTTY) {
  console.error("This prototype needs an interactive terminal.");
  process.exit(1);
}

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdin.resume();
process.stdin.on("data", key => {
  const input = String(key);
  if (input === "q" || input === "\u0003") {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    console.clear();
    process.exit(0);
    return;
  }
  const action = actions[input];
  if (action) {
    state = reducePrototype(state, action);
    render();
  }
});

render();
