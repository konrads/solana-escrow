import * as anchor from "@project-serum/anchor";
import { Keypair } from "@solana/web3.js";
import { createMint, createAccount } from "@solana/spl-token";

describe("debug", () => {
  const provider = anchor.Provider.env();
  const airdrop = 100000000;

  it("Issues with: Unable to obtain a new blockhash after 10187ms", async () => {
    const user = Keypair.generate();
    const acc1 = Keypair.generate();
    const acc2 = Keypair.generate();

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(user.publicKey, airdrop),
      "confirmed"
    );
    const mintAuthority = Keypair.generate();
    const mint = await createMint(
      provider.connection,
      user,
      mintAuthority.publicKey,
      null,
      0
    );

    await createAccount(provider.connection, user, mint, user.publicKey, acc1);
    // This test runs fine for me.
    await createAccount(provider.connection, user, mint, user.publicKey, acc2);
  });
});
