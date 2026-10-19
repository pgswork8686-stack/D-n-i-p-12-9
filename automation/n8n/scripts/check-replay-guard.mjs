#!/usr/bin/env node
/**
 * Behavioural check of the ingress replay guard generated into every dispatch workflow
 * (automation/n8n/workflows/*.json, "Verify Nexus Dispatch" node). It runs the GENERATED code itself,
 * not a copy, against a fake Redis speaking RESP on 127.0.0.1, so it needs no Redis, Docker or n8n.
 *
 * The guard must be fail-closed:
 *  - a first request claims the key, a replay is rejected;
 *  - with N8N_REPLAY_REDIS_PASSWORD set, the AUTH "+OK" must never be taken for the SET claim, even when it
 *    arrives in its own TCP chunk (that once let replays through);
 *  - a refused AUTH, a connection closed before the SET reply, silence and a missing endpoint all reject.
 *
 * Usage: node automation/n8n/scripts/check-replay-guard.mjs   (part of `pnpm n8n:validate`)
 */
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const WORKFLOWS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../workflows");
const START = "const redisHost";
const END = "if (claim === 'duplicate')";

/** The replay-guard portion of a workflow's verify code, as an async function returning "claimed" | "duplicate". */
function guardsIn(file) {
  const wf = JSON.parse(fs.readFileSync(path.join(WORKFLOWS, file), "utf8"));
  return (wf.nodes || [])
    .filter((n) => String(n.parameters?.jsCode || "").includes("dispatch-replay"))
    .map((n) => {
      const code = n.parameters.jsCode;
      const start = code.indexOf(START);
      const end = code.indexOf(END);
      if (start < 0 || end < start) throw new Error(`${file} › ${n.name}: replay guard markers not found`);
      return { name: `${file} › ${n.name}`, run: new Function("$env", "net", "requestId", "require", `return (async () => { ${code.slice(start, end)}; return claim; })();`) };
    });
}

/**
 * A fake Redis. `script(sock, commands)` is called on every complete command with all commands received so far
 * on that connection; it decides what (if anything) to write back and when.
 */
async function fakeRedis(script) {
  const server = net.createServer((sock) => {
    let buf = "";
    const commands = [];
    sock.on("error", () => {});
    sock.on("data", (d) => {
      buf += d.toString();
      // Each command starts with "*<n>"; count the complete ones by their argument headers.
      for (;;) {
        const m = /^\*(\d+)\r\n/.exec(buf);
        if (!m) return;
        let rest = buf.slice(m[0].length);
        const args = [];
        for (let i = 0; i < Number(m[1]); i++) {
          const h = /^\$(\d+)\r\n/.exec(rest);
          if (!h || rest.length < h[0].length + Number(h[1]) + 2) return;
          args.push(rest.slice(h[0].length, h[0].length + Number(h[1])));
          rest = rest.slice(h[0].length + Number(h[1]) + 2);
        }
        buf = rest;
        commands.push(args[0].toUpperCase());
        script(sock, commands);
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

/**
 * The `net` handed to the guard: it may only reach the fake Redis of the current scenario. Anything else (for
 * example a default 127.0.0.1:6379, which on a developer machine can be another project's Redis) is refused
 * before a socket is opened, so this check can never touch a real Redis even when the guard regresses.
 */
function netOnlyTo(port) {
  return {
    createConnection(options) {
      if (options?.host !== "127.0.0.1" || options?.port !== port) {
        throw new Error(`check refused to connect to ${options?.host}:${options?.port} (only the fake Redis on 127.0.0.1:${port})`);
      }
      return net.createConnection(options);
    },
  };
}

const later = (ms, fn) => setTimeout(fn, ms);
const scenarios = [
  { name: "no password, first request", password: "", expect: "claimed", script: (s, c) => c.at(-1) === "SET" && s.write("+OK\r\n") },
  { name: "no password, replay", password: "", expect: "duplicate", script: (s, c) => c.at(-1) === "SET" && s.write("$-1\r\n") },
  {
    name: "password, replay, AUTH +OK in its own chunk", password: "pw", expect: "duplicate",
    script: (s, c) => { if (c.at(-1) === "AUTH") s.write("+OK\r\n"); if (c.at(-1) === "SET") later(50, () => s.write("$-1\r\n")); },
  },
  {
    name: "password, first request, replies in separate chunks", password: "pw", expect: "claimed",
    script: (s, c) => { if (c.at(-1) === "AUTH") s.write("+OK\r\n"); if (c.at(-1) === "SET") later(50, () => s.write("+OK\r\n")); },
  },
  {
    name: "password refused", password: "wrong", expect: "reject",
    script: (s, c) => { if (c.at(-1) === "AUTH") s.write("-WRONGPASS invalid username-password pair\r\n"); if (c.at(-1) === "SET") s.write("-NOAUTH Authentication required.\r\n"); },
  },
  { name: "connection closed after AUTH +OK, no SET reply", password: "pw", expect: "reject", script: (s, c) => { if (c.at(-1) === "AUTH") { s.write("+OK\r\n"); later(50, () => s.end()); } } },
  { name: "Redis never answers", password: "", expect: "reject", script: () => {} },
];

let failures = 0;
const report = (ok, label, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures += 1;
};
const outcome = (p) => p.then((v) => v, (e) => `reject: ${e.message}`);

const files = fs.readdirSync(WORKFLOWS).filter((f) => f.endsWith(".json"));
const guards = files.flatMap(guardsIn);
report(guards.length >= 3, "replay guard found in the dispatch workflows", guards.map((g) => g.name).join(", "));

for (const guard of guards) {
  for (const sc of scenarios) {
    const redis = await fakeRedis(sc.script);
    const env = { N8N_REPLAY_REDIS_HOST: "127.0.0.1", N8N_REPLAY_REDIS_PORT: String(redis.port), N8N_REPLAY_REDIS_PASSWORD: sc.password };
    const got = await outcome(guard.run(env, netOnlyTo(redis.port), `check-${Date.now()}`, require));
    await redis.close();
    const ok = sc.expect === "reject" ? String(got).startsWith("reject") : got === sc.expect;
    report(ok, `${guard.name}: ${sc.name} -> ${sc.expect}`, `got ${got}`);
  }
  for (const [label, env] of [["host unset", { N8N_REPLAY_REDIS_PORT: "6379" }], ["port unset", { N8N_REPLAY_REDIS_HOST: "127.0.0.1" }]]) {
    // Port 0 is never a real endpoint: any connection attempt is refused by netOnlyTo, not attempted.
    const got = await outcome(guard.run(env, netOnlyTo(0), `check-${Date.now()}`, require));
    const refusedByCheck = String(got).includes("check refused to connect");
    report(String(got).startsWith("reject") && !refusedByCheck, `${guard.name}: endpoint ${label} -> reject before connecting (no default to :6379)`, `got ${got}`);
  }
}

console.log(failures ? `\nREPLAY GUARD CHECK FAILED: ${failures} failure(s)` : "\nreplay guard checks passed");
process.exit(failures ? 1 : 0);
