# Sealed Assignment

Three service providers quote on three jobs. A NEAR contract releases escrow only when a zero-knowledge proof shows that the chosen assignment has the lowest total cost across all six valid assignments. The proof reveals the three winning prices and keeps the six unused quotes off-chain.

Built for the November 2026 [NEAR Hackathon](https://nearhackathon.com/), with **Privacy & Private AI** as the proposed primary track. The fixture uses synthetic service-provider quotes.

## Try the browser demo

Run `python -m http.server 8080 --directory docs` from the combined repository and open `http://127.0.0.1:8080/`. Choose **Enter local demo**, then **Auction Lab**. Run the sample auction, generate and verify the proof, and open the settlement evidence. The browser creates a fresh proof for each run. The settlement report records a separate run of the same auction against the contract.

The recorded NEAR testnet run funded 30 milliNEAR of escrow, rejected a changed payout, paid 13 milliNEAR across three providers, and returned 17 milliNEAR to the buyer. See the [rejected transaction](https://testnet.nearblocks.io/txns/7EcUCoaipNafsxSz1c7Z2aBKxczT2Npi3AZxM8HTDgZf), the [successful settlement](https://testnet.nearblocks.io/txns/8fMtkv2pKiJTnhdN4DXR2jsjThVcWSd4QxgKWY2VZXng), and [all transaction hashes](docs/assets/chain-run.json).

## Run the demo

Use Node.js 22 or newer. Install the pinned JavaScript dependencies and build disposable proving parameters.

```sh
npm ci --ignore-scripts
npm run setup
npm run demo
npm test
```

On Windows, set `CIRCOM` to the absolute path of the native [Circom compiler](https://github.com/iden3/circom/releases/tag/v2.2.2) before running setup. The bundled WebAssembly compiler is the default on Linux.

The demo awards jobs 1, 2, and 3 to providers B, A, and C at 4, 3, and 6 milliNEAR. A is the cheapest provider for both of the first two jobs. Reserving A for job 2 yields a total of 13 milliNEAR. The proof verifies for those prices and fails after a price is changed.

## Run the NEAR settlement

Use Linux x64 or Ubuntu under WSL for NEAR Sandbox. Install Rust 1.99 and its `wasm32-unknown-unknown` target. Run from the repository root after setup. Use NEAR Sandbox 2.14.1 for compatibility with current Rust-generated WebAssembly.

```sh
rustup target add wasm32-unknown-unknown
(cd contract && cargo near build non-reproducible-wasm --locked --no-abi)
mkdir -p build/sandbox
curl -fsSL https://s3-us-west-1.amazonaws.com/build.nearprotocol.com/nearcore/Linux-x86_64/2.14.1/near-sandbox.tar.gz -o build/sandbox/node.tar.gz
tar -xzf build/sandbox/node.tar.gz -C build/sandbox
NEAR_SANDBOX_BIN_PATH=1 NEAR_SANDBOX_BINARY_PATH="$PWD/build/sandbox/Linux-x86_64" npm run sandbox
```

Install [cargo-near](https://github.com/near/cargo-near) before the contract build. The script deploys a market to a disposable local chain and funds it with 30 milliNEAR. Three accounts submit commitments. The script tries a changed payout, settles the original result, tries to settle it again, and withdraws each provider's payout and the buyer's 17 milliNEAR refund. Set `SEALED_RUN_REPORT` to write a JSON report with the transaction hashes.

To attempt the same run on public testnet using only faucet test tokens, run `npm run sandbox -- --testnet-faucet`. This creates temporary public testnet accounts with an in-memory key and requires a working NEAR testnet faucet and RPC.

## How settlement works

1. The buyer deploys and initializes a separate market account in one transaction and attaches the escrow deposit. The contract fixes the three bidder accounts and the deadline. It derives the market identifier from the contract account ID.
2. Each bidder commits a salted Poseidon hash of its three quotes, its bidder slot, and the market identifier. The contract accepts one commitment per account.
3. The prover finds the cheapest permutation. The Circom circuit checks the three commitment openings, positive 24-bit quotes, the three claimed payouts, and the chosen assignment against all six permutations. Ties resolve to the first permutation in lexicographic order by bidder slot.
4. The contract builds the proof's public inputs from stored commitments and the proposed award. It verifies Groth16 with NEAR's BN254 host functions, caps payment at escrow, and credits the three recipients and the buyer. A failed withdrawal restores credit through a callback. If the market expires before settlement, the buyer can reclaim escrow.

## Prototype scope

The fixture's prover sees the full quote matrix. Bid privacy applies to on-chain observers, who can still infer bounds from the public result. The local setup creates fresh demo keys each time. Rebuild the contract after setup so its embedded verification key matches the prover. The Sandbox market account retains a development key. Use the prototype with local or test funds. Settlement occurs at award time.

The main extension is a private prover that receives encrypted bidder inputs and proves optimality using an assignment dual certificate. Checking the certificate across provider–job edges can replace enumerating permutations, making larger batches practical.

## Related work

[VeilProcure](https://github.com/Olalekan2345/veilprocure) is a NEAR Hackathon entry for confidential supplier selection and escrow. [PrivateBid](https://devpost.com/software/privatebid-lozrn6) and [Sealed Bid RFP](https://github.com/Gamferno/sealed-bid-rfp) also demonstrate sealed procurement. This prototype proves the optimum for a joint assignment with exclusive provider slots, then uses that proof to authorize multiple NEAR payouts.
