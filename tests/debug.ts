import * as anchor from "@project-serum/anchor";
import { Keypair } from "@solana/web3.js";
import { createMint, createAccount } from "@solana/spl-token";

describe("debug", () => {
  const provider = anchor.Provider.env();
  const airdrop = 1000000000000000;

  it("Issues with: Unable to obtain a new blockhash after 10187ms", async () => {
    const wallet = Keypair.generate();
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(wallet.publicKey, airdrop),
      "confirmed"
    );
    const mintAuthority = Keypair.generate();
    const mint = await createMint(provider.connection, wallet, mintAuthority.publicKey, null, 0);

    await createAccount(provider.connection, wallet, mint, wallet.publicKey);
    await createAccount(provider.connection, wallet, mint, wallet.publicKey);
  });
});
