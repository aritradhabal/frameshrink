import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  stat,
  chmod,
  symlink,
  mkdir,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createWallet, walletStatus, fundWallet } from "../src/wallet.js";
import {
  DevnetRpcError,
  readDevnet,
  type DevnetReader,
} from "../src/devnet.js";
const txHash = "0x" + "12".repeat(32);
async function temp<T>(fn: (directory: string) => Promise<T>) {
  const root = await mkdtemp(path.join(tmpdir(), "frameshrink-wallet-"));
  try {
    return await fn(path.join(root, "wallet"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function fake(
  address: string,
  overrides: { chain?: string; faucet?: boolean; receipt?: unknown } = {},
) {
  let funded = false,
    calls = 0;
  const reader: DevnetReader = async (method) => {
    if (method === "eth_chainId") return overrides.chain ?? "0x539";
    if (method === "skandha_explorer_info")
      return {
        chainId: 1337,
        protocolVersion: 1,
        faucetEnabled: overrides.faucet ?? true,
      };
    if (method === "eth_getBalance")
      return funded ? "0xde0b6b3a7640000" : "0x0";
    if (method === "eth_getTransactionReceipt")
      return "receipt" in overrides
        ? overrides.receipt
        : {
            transactionHash: txHash,
            to: address,
            status: "0x1",
            blockNumber: "0x100",
          };
    throw Error("Unexpected test method");
  };
  const request = async (recipient: string) => {
    assert.equal(recipient, address);
    calls++;
    funded = true;
    return { txHash, amount: "1000000000000000000" };
  };
  return {
    reader,
    request,
    get calls() {
      return calls;
    },
  };
}
test("test wallet creation persists private permissions, is idempotent and never returns its key", async () =>
  temp(async (directory) => {
    const a = await createWallet(directory),
      b = await createWallet(directory);
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.address, b.address);
    assert.match(a.address, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(
      (await stat(path.join(directory, "key.json"))).mode & 0o777,
      0o600,
    );
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    const key = JSON.parse(
      await readFile(path.join(directory, "key.json"), "utf8"),
    ).privateKey;
    assert.equal(JSON.stringify(a).includes(key), false);
    assert.equal(
      JSON.stringify(await walletStatus({ directory, offline: true })).includes(
        key,
      ),
      false,
    );
    await writeFile(path.join(directory, "key.json"), "bad", { mode: 0o600 });
    await assert.rejects(() => createWallet(directory), /was not replaced/);
    assert.equal(
      await readFile(path.join(directory, "key.json"), "utf8"),
      "bad",
    );
  }));
test("wallet refuses insecure permissions and a symlinked directory", async () =>
  temp(async (directory) => {
    await createWallet(directory);
    await chmod(path.join(directory, "key.json"), 0o644);
    await assert.rejects(
      () => walletStatus({ directory, offline: true }),
      /insecure/,
    );
    const link = directory + "-link";
    await symlink(directory, link);
    await assert.rejects(() => createWallet(link), /symlink/);
  }));
test("faucet confirms the actual matching receipt and does not double-request during cooldown", async () =>
  temp(async (directory) => {
    const wallet = await createWallet(directory);
    const rpc = fake(wallet.address);
    const a = await fundWallet({ directory, ...rpc, waitMs: 0 });
    assert.equal(a.fundingConfirmed, true);
    assert.equal(a.balanceEth, "1");
    assert.equal(a.faucet.state, "confirmed");
    const b = await fundWallet({ directory, ...rpc, waitMs: 0 });
    assert.equal(b.requestedNow, false);
    assert.equal(rpc.calls, 1);
  }));
test("wrong chain, disabled faucet and invalid options cause no faucet write", async () =>
  temp(async (directory) => {
    const wallet = await createWallet(directory);
    for (const options of [{ chain: "0x1" }, { faucet: false }]) {
      const rpc = fake(wallet.address, options);
      await assert.rejects(() => fundWallet({ directory, ...rpc, waitMs: 0 }));
      assert.equal(rpc.calls, 0);
    }
    const rpc = fake(wallet.address);
    await assert.rejects(() => fundWallet({ directory, ...rpc, waitMs: -1 }));
    assert.equal(rpc.calls, 0);
    await assert.rejects(
      () => readDevnet("eth_sendRawTransaction", []),
      /not allowed/,
    );
  }));
test("unknown faucet response is recorded and never retried blindly", async () =>
  temp(async (directory) => {
    const wallet = await createWallet(directory);
    const rpc = fake(wallet.address);
    let calls = 0;
    const request = async () => {
      calls++;
      throw new DevnetRpcError("Connection lost", true);
    };
    const a = await fundWallet({
      directory,
      reader: rpc.reader,
      request,
      waitMs: 0,
    });
    assert.equal(a.faucet.state, "unknown");
    assert.equal(a.fundingConfirmed, false);
    await fundWallet({ directory, reader: rpc.reader, request, waitMs: 0 });
    assert.equal(calls, 1);
  }));
test("pending funding stays pending until a successful receipt, and mismatched receipts are refused", async () =>
  temp(async (directory) => {
    const wallet = await createWallet(directory);
    const rpc = fake(wallet.address, { receipt: null });
    const a = await fundWallet({ directory, ...rpc, waitMs: 0 });
    assert.equal(a.faucet.state, "pending");
    assert.equal(a.fundingConfirmed, false);
    await fundWallet({ directory, ...rpc, waitMs: 0 });
    assert.equal(rpc.calls, 1);
    const wrong = fake(wallet.address, {
      receipt: {
        transactionHash: txHash,
        to: "0x" + "99".repeat(20),
        status: "0x1",
        blockNumber: "0x100",
      },
    });
    await assert.rejects(
      () => fundWallet({ directory, ...wrong, waitMs: 0 }),
      /does not match/,
    );
    assert.equal(wrong.calls, 0);
  }));
