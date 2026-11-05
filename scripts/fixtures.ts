import { readFile, writeFile } from "node:fs/promises";
import solc from "solc";
import { ROOT, saveJSON, bytesHash } from "../src/shared.js";
import { WALLET, BANNED, SINK, parseRecipe } from "../src/recipe.js";
const source = await readFile(ROOT + "contracts/PayloadSink.sol", "utf8");
const input = {
  language: "Solidity",
  sources: { "PayloadSink.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "cancun",
    outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object"] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors?.some((e: { severity: string }) => e.severity === "error"))
  throw Error(JSON.stringify(output.errors));
const artifact = output.contracts["PayloadSink.sol"].PayloadSink;
await saveJSON(ROOT + "contracts/PayloadSink.artifact.json", {
  compiler: solc.version(),
  sourceSha256: bytesHash(source),
  input,
  abi: artifact.abi,
  runtimeBytecode: "0x" + artifact.evm.deployedBytecode.object,
});
const genesis = JSON.parse(
  await readFile(ROOT + "fixtures/genesis.upstream.json", "utf8"),
);
for (const [address, code] of [
  [WALLET, "0x600360006000aa"],
  [BANNED, "0x42600360006000aa"],
  [SINK, "0x" + artifact.evm.deployedBytecode.object],
])
  genesis.alloc[address.slice(2)] = {
    balance: "0x3635c9adc5dea00000",
    nonce: "0x1",
    code,
    storage: {},
  };
await saveJSON(ROOT + "fixtures/genesis.json", genesis);
for (const family of ["verify-gas", "banned-opcode"] as const) {
  const r = parseRecipe({
    schemaVersion: 1,
    mode: "owned",
    family,
    name: family,
    prefixGas: family === "verify-gas" ? 120000 : 30000,
    body: [
      { id: "required-call", required: true, values: [1, 2, 3, 4] },
      { id: "extra-a", required: false, values: [10, 20] },
      { id: "extra-b", required: false, values: [30, 40, 50] },
    ],
  });
  await saveJSON(ROOT + `fixtures/${family}.json`, r);
}
console.log(
  "Compiled owned payload contract and generated deterministic local genesis and recipes.",
);
