/**
 * Isolated Docker resources for the n8n test scripts (runtime-smoke.mjs, live-flow-check.mjs).
 *
 * The workflows claim `nexus:n8n:dispatch-replay:<requestId>` keys in Redis (fail-closed replay guard). A test must
 * never write those keys into a Redis that belongs to something else; on a dev machine host :6379 is often another
 * project's Redis. So:
 *  - default: the test starts its OWN Redis on its OWN Docker network, with no published host port;
 *  - override: N8N_REPLAY_REDIS_HOST + N8N_REPLAY_REDIS_PORT (both, as reached from the n8n container). Before any
 *    connection, Docker metadata must show the target is a container labelled com.nexustheme.test: either that
 *    container's name, or host.docker.internal plus a host port published by exactly one such container. Only then a
 *    read-only GET of "nexustheme:test-env" must return a value starting with "nexustheme-test". Nothing is written,
 *    deleted or flushed there by the check; mark a dedicated test Redis yourself:
 *      redis-cli -h <host> -p <port> SET nexustheme:test-env nexustheme-test-<name>
 *  - cleanup removes only resources that carry this test's owner label. Never a global prune.
 */
import { spawnSync } from "node:child_process";

export const TEST_ENV_KEY = "nexustheme:test-env";
const OWNER_KEY = "com.nexustheme.test";
const GATEWAY = "host.docker.internal:host-gateway";

function docker(args, { tolerate = false, timeout = 300000 } = {}) {
  const r = spawnSync("docker", args, { encoding: "utf8", timeout, shell: false });
  if (r.status !== 0 && !tolerate) throw new Error(`docker ${args.join(" ")} failed (${r.status}): ${r.stdout}\n${r.stderr}`);
  return r;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} o
 * @param {string} o.prefix      resource name prefix, e.g. "nexus-n8n-live" (network `<prefix>-net`, Redis `<prefix>-redis`)
 * @param {string} o.owner       owner label value, e.g. "n8n-live"
 * @param {string} o.n8nName     the n8n container name the script uses
 * @param {string} o.volume      the n8n data volume name
 * @param {(ok: boolean, label: string, extra?: string) => void} o.report  records a check; must throw when ok is false
 * @param {Record<string, string | undefined>} [o.env]
 */
export function isolatedN8nEnv({ prefix, owner, n8nName, volume, report, env = process.env }) {
  const label = `${OWNER_KEY}=${owner}`;
  const network = `${prefix}-net`;
  const redisName = `${prefix}-redis`;
  const redisImage = env.N8N_TEST_REDIS_IMAGE || "redis:7-alpine";
  const external = Boolean(env.N8N_REPLAY_REDIS_HOST || env.N8N_REPLAY_REDIS_PORT);
  // Owned mode: the container name and Redis's port INSIDE the private network (nothing is published on the host).
  const redisHost = external ? env.N8N_REPLAY_REDIS_HOST : redisName;
  const redisPort = external ? Number(env.N8N_REPLAY_REDIS_PORT) : 6379;

  /** "absent" | "owned" | "foreign", decided by the owner label only. */
  function ownership(kind, name) {
    const labels = kind === "container" ? ".Config.Labels" : ".Labels";
    const r = docker([kind, "inspect", "--format", `{{index ${labels} "${OWNER_KEY}"}}`, name], { tolerate: true });
    if (r.status !== 0) return "absent";
    return String(r.stdout).trim() === owner ? "owned" : "foreign";
  }

  /**
   * Removes owned containers (with their anonymous volumes, e.g. redis's /data), then the named volume, then the
   * network. A same-named resource without the label is never touched: before a run that is fatal (strict), during
   * final cleanup it is a warning.
   */
  function cleanup({ strict = false } = {}) {
    for (const [kind, name] of [["container", n8nName], ["container", redisName], ["volume", volume], ["network", network]]) {
      const state = ownership(kind, name);
      if (state === "owned") docker([kind, "rm", ...(kind === "container" ? ["-f", "-v"] : []), name], { tolerate: true });
      if (state === "foreign") {
        const msg = `${kind} ${name} exists without the label ${label}; leaving it untouched`;
        if (strict) throw new Error(`${msg}. Remove or rename it yourself, then rerun.`);
        console.warn("WARN: " + msg);
      }
    }
  }

  /** Decides from Docker metadata alone (no connection) whether an external Redis endpoint is a labelled test container. */
  function externalTarget() {
    if (redisHost === "host.docker.internal") {
      const rows = String(docker(["ps", "--filter", `publish=${redisPort}`, "--format", `{{.Names}}|{{.Label "${OWNER_KEY}"}}`]).stdout)
        .split(/\r?\n/).filter(Boolean);
      const labelled = rows.length === 1 && rows[0].split("|")[1] !== "";
      return { ok: labelled, detail: rows.length ? rows.join(", ") : `no container publishes host port ${redisPort}` };
    }
    const r = docker(["container", "inspect", "--format", `{{index .Config.Labels "${OWNER_KEY}"}}`, redisHost], { tolerate: true });
    const value = String(r.stdout || "").trim();
    return { ok: r.status === 0 && value !== "" && value !== "<no value>", detail: r.status === 0 ? `${redisHost} label=${value}` : `${redisHost} is not a container` };
  }

  async function preflightRedis() {
    if (external) {
      const target = externalTarget();
      report(target.ok, `external replay Redis ${redisHost}:${redisPort} belongs to a container labelled ${OWNER_KEY} (checked before connecting)`, target.detail);
      const auth = env.N8N_REPLAY_REDIS_PASSWORD ? ["-a", env.N8N_REPLAY_REDIS_PASSWORD, "--no-auth-warning"] : [];
      const probe = docker(["run", "--rm", "--label", label, "--network", network, "--add-host", GATEWAY, redisImage,
        "redis-cli", "-h", redisHost, "-p", String(redisPort), ...auth, "GET", TEST_ENV_KEY], { tolerate: true, timeout: 60000 });
      const marker = String(probe.stdout || "").trim();
      report(probe.status === 0 && marker.startsWith("nexustheme-test"),
        `external replay Redis ${redisHost}:${redisPort} is marked as a NexusTheme test Redis (${TEST_ENV_KEY})`,
        marker ? `marker=${marker}` : "marker missing: refusing to use it");
      return;
    }
    docker(["run", "-d", "--name", redisName, "--label", label, "--network", network, redisImage]);
    for (let i = 0; !String(docker(["exec", redisName, "redis-cli", "PING"], { tolerate: true }).stdout || "").includes("PONG"); i++) {
      if (i >= 30) throw new Error(`Timed out waiting for the test's own Redis (${redisName})`);
      await sleep(1000);
    }
    const runMarker = `nexustheme-test-${owner}-${Date.now()}`;
    docker(["exec", redisName, "redis-cli", "SET", TEST_ENV_KEY, runMarker]);
    const inspect = (format) => docker(["inspect", "--format", format, redisName]).stdout.trim();
    const ownerLabel = inspect(`{{index .Config.Labels "${OWNER_KEY}"}}`);
    const bindings = inspect("{{json .HostConfig.PortBindings}}");
    const publishAll = inspect("{{.HostConfig.PublishAllPorts}}");
    const livePorts = inspect("{{json .NetworkSettings.Ports}}");
    const networks = inspect("{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}");
    const readBack = docker(["exec", redisName, "redis-cli", "GET", TEST_ENV_KEY]).stdout.trim();
    const noHostPort = ["{}", "null"].includes(bindings) && publishAll === "false" && !livePorts.includes("HostPort");
    report(ownerLabel === owner && noHostPort && networks === network && readBack === runMarker,
      "the replay Redis is the test's own container (labelled, private network only, no host port, marked by this run)",
      `${redisName} network=${networks} ports=${livePorts}`);
  }

  /** Strict cleanup of leftovers, then the owned network, volume and the verified replay Redis. */
  async function prepare() {
    if (external && (!env.N8N_REPLAY_REDIS_HOST || !Number.isInteger(redisPort) || redisPort < 1 || redisPort > 65535)) {
      throw new Error("Set BOTH N8N_REPLAY_REDIS_HOST and N8N_REPLAY_REDIS_PORT (1-65535), or neither to use the test's own Redis.");
    }
    cleanup({ strict: true });
    docker(["network", "create", "--label", label, network]);
    docker(["volume", "create", "--label", label, volume]);
    await preflightRedis();
  }

  /** True when `url` answers HTTP (any status) from inside the test network, i.e. where n8n will call it from. */
  function reachableFromNetwork(url, image) {
    const probe = `fetch(${JSON.stringify(url)}, { signal: AbortSignal.timeout(5000) }).then(() => process.exit(0), () => process.exit(1))`;
    return docker(["run", "--rm", "--label", label, "--network", network, "--add-host", GATEWAY, "--entrypoint", "node", image, "-e", probe],
      { tolerate: true, timeout: 60000 }).status === 0;
  }

  return {
    prepare,
    cleanup,
    reachableFromNetwork,
    /** `docker run` arguments that put an n8n container in this test's ownership, network and data volume. */
    runArgs: ["--label", label, "--network", network, "--add-host", GATEWAY, "-v", `${volume}:/home/node/.n8n`],
    /** `docker run` environment for the workflows' replay guard. */
    replayEnv: ["-e", `N8N_REPLAY_REDIS_HOST=${redisHost}`, "-e", `N8N_REPLAY_REDIS_PORT=${redisPort}`,
      ...(external && env.N8N_REPLAY_REDIS_PASSWORD ? ["-e", `N8N_REPLAY_REDIS_PASSWORD=${env.N8N_REPLAY_REDIS_PASSWORD}`] : [])],
  };
}
