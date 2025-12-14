/**
 * Quick PoW availability tester for the built-in server list.
 * Usage: node scripts/test-pow-servers.js [hash]
 *
 * - Sends a work_generate to each known API endpoint.
 * - Times the request and checks the returned work format.
 * - Set an optional block hash via CLI arg; otherwise a placeholder is used.
 *
 * Note: Requires Node 18+ (built-in fetch).
 */
const servers = [
  { name: 'XNOPay UK 1', api: 'https://uk1.public.xnopay.com/proxy' },
  { name: 'Rainstorm City', api: 'https://rainstorm.city/api' },
  { name: 'NanOslo', api: 'https://nanoslo.0x.no/proxy' },
];

const hashArg = process.argv[2];
const testHash =
  hashArg ||
  '0000000000000000000000000000000000000000000000000000000000000000';

// Same base threshold used in PowService (Banano)
const difficulty = 'fffffe0000000000';
const timeoutMs = 15000;

async function testServer(server) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(server.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'work_generate',
        hash: testHash,
        difficulty,
      }),
      signal: controller.signal,
    });
    const elapsed = Date.now() - start;
    const text = await res.text();

    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      // leave payload null
    }

    if (!res.ok) {
      return {
        name: server.name,
        ok: false,
        status: res.status,
        elapsed,
        msg: `HTTP ${res.status}`,
      };
    }

    if (!payload || typeof payload.work !== 'string' || payload.work.length !== 16) {
      return {
        name: server.name,
        ok: false,
        status: res.status,
        elapsed,
        msg: 'Invalid response',
        sample: text.slice(0, 200),
      };
    }

    return {
      name: server.name,
      ok: true,
      status: res.status,
      elapsed,
      work: payload.work,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    return {
      name: server.name,
      ok: false,
      status: null,
      elapsed,
      msg: err.name === 'AbortError' ? 'Timed out' : err.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

(async () => {
  console.log(`Testing PoW servers with hash: ${testHash}`);
  console.log(`Timeout per server: ${timeoutMs}ms\n`);

  const results = [];
  for (const server of servers) {
    process.stdout.write(`-> ${server.name} ... `);
    const result = await testServer(server);
    results.push(result);

    if (result.ok) {
      console.log(`OK in ${result.elapsed}ms (work: ${result.work})`);
    } else {
      console.log(`FAIL (${result.msg || 'unknown'}) in ${result.elapsed}ms`);
    }
  }

  const ok = results.filter(r => r.ok).length;
  console.log(`\nSummary: ${ok}/${results.length} passed`);
  results.forEach(r => {
    console.log(
      `${r.ok ? '✓' : '✗'} ${r.name} – ${r.ok ? `${r.elapsed}ms` : r.msg || 'unknown'}`
    );
  });
})();
