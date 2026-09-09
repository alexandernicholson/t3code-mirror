import * as NodeAssert from "node:assert/strict";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import { parseBrowserArgs, runBrowser, validatePairingUrl } from "./web-browser.ts";

void NodeTest.test(
  "requires observable readiness and keeps pairing credentials out of navigation arguments",
  () => {
    NodeAssert.throws(() => parseBrowserArgs(["--url", "http://localhost:1234"]), /readiness/);
    NodeAssert.throws(
      () =>
        parseBrowserArgs(["--url", "http://localhost:1234/pair#token=secret", "--wait-for", "h1"]),
      /credentials/,
    );
    NodeAssert.throws(
      () =>
        parseBrowserArgs(["--url", "http://localhost:1234", "--wait-for", "h1", "--width", "0"]),
      /positive integer/,
    );
    NodeAssert.throws(
      () => validatePairingUrl("http://localhost:4567/pair#token=secret", "http://localhost:1234"),
      /match/,
    );
    NodeAssert.equal(
      validatePairingUrl("http://localhost:1234/pair#token=secret\n", "http://localhost:1234"),
      "http://localhost:1234/pair#token=secret",
    );
  },
);

void NodeTest.test(
  "pairs, reuses auth, captures UI, propagates check failures, and releases its state lock",
  async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-web-browser-"));
    const server = NodeHttp.createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end(`<h1>Not paired</h1><button>Inspect</button><script>
        const request = indexedDB.open('test-auth', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('tokens');
        request.onsuccess = () => {
          const database = request.result;
          if (location.pathname === '/pair') {
            const transaction = database.transaction('tokens', 'readwrite');
            transaction.objectStore('tokens').put('yes', 'paired');
            transaction.oncomplete = () => location.replace('/');
          } else {
            const read = database.transaction('tokens').objectStore('tokens').get('paired');
            read.onsuccess = () => {
              if (read.result === 'yes') document.querySelector('h1').textContent = 'Paired';
            };
          }
        };
        document.querySelector('button').onclick = () => document.querySelector('h1').textContent = 'Checked';
      </script>`);
    });
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      NodeAssert.ok(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}`;
      const pairingPath = NodePath.join(directory, "pair.txt");
      await NodeFSP.writeFile(pairingPath, `${url}/pair#token=test-only`, { mode: 0o600 });
      const args = ["--url", url, "--state-dir", directory, "--timeout", "5000"];
      await runBrowser([
        ...args,
        "--pair-url-file",
        pairingPath,
        "--wait-for",
        'h1:text-is("Paired")',
      ]);
      const png = await NodeFSP.readFile(NodePath.join(directory, "screenshot.png"));
      NodeAssert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      NodeAssert.equal(png.readUInt32BE(16), 1440);
      NodeAssert.equal(png.readUInt32BE(20), 900);
      const checkPath = NodePath.join(directory, "check.mjs");
      await NodeFSP.writeFile(
        checkPath,
        `export default async ({page}) => {
      await page.getByRole('heading', {name: 'Paired', exact: true}).waitFor();
      await page.getByRole('button', {name: 'Inspect'}).click();
      await page.getByRole('heading', {name: 'Checked', exact: true}).waitFor();
    };`,
      );
      await runBrowser([...args, "--script", checkPath]);
      const failingPath = NodePath.join(directory, "fail.mjs");
      await NodeFSP.writeFile(
        failingPath,
        `export default async () => { throw new Error('expected check failure'); };`,
      );
      await NodeAssert.rejects(
        runBrowser([...args, "--script", failingPath]),
        /expected check failure/,
      );
      await NodeAssert.rejects(NodeFSP.access(NodePath.join(directory, "running.lock")));
      await NodeFSP.writeFile(NodePath.join(directory, "running.lock"), "");
      await NodeAssert.rejects(runBrowser([...args, "--script", checkPath]), /state is in use/);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  },
);
