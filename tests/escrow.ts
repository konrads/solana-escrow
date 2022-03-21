import * as anchor from "@project-serum/anchor";
import { Program, BN, IdlAccounts } from "@project-serum/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";
import { Escrow } from "../target/types/escrow";

type EscrowAccount = IdlAccounts<Escrow>["escrowAccount"];

// import { provider, program } from '../config';

// export function programPaidBy(payer: anchor.web3.Keypair): anchor.Program {
//   const newProvider = new anchor.Provider(provider.connection, new anchor.Wallet(payer), {});

//   return new anchor.Program(program.idl as anchor.Idl, program.programId, newProvider)
// }


describe("escrow", () => {
  const provider = anchor.Provider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Escrow as Program<Escrow>;
  // const payer = Keypair.generate();

  const giver = Keypair.generate();
  const taker = Keypair.generate();
//  const payer = Keypair.generate();

  const takerProvider = provider; // FIXME: new anchor.Provider(provider.connection, new anchor.Wallet(taker), {});

  let mint: PublicKey = null;
  let mintAuthority = Keypair.generate();
  let vaultAuthority: PublicKey = null;  // PDA
  let vaultAuthorityBump: number = null;

  let giverTokenAccount: PublicKey = null;
  let takerTokenAccount: PublicKey = null;

  const escrowAccount = Keypair.generate();
  const vaultTokenAccount = Keypair.generate();

  const giverBalance = 10000000000;
  const escrowAmount = 100000;

  before(async () => {
    // Airdropping tokens to a giver/taker
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(giver.publicKey, 1000000000000),
      "confirmed"
    );

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(taker.publicKey, 10000000000),
      "confirmed"
    );

    // mint holds token metadata
    mint = await createMint(provider.connection, giver, mintAuthority.publicKey, null, 0);

    giverTokenAccount = await createAccount(provider.connection, giver, mint, giver.publicKey);
    takerTokenAccount = await createAccount(provider.connection, taker, mint, taker.publicKey);

    await mintTo(provider.connection, giver, mint, giverTokenAccount, mintAuthority, giverBalance);

    const [_pda, _bumpSeed] = await PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("escrow"))],
      program.programId
    );

    vaultAuthority = _pda;
    vaultAuthorityBump = _bumpSeed;
  });

  it("Initialize escrow", async () => {
    await program.rpc.deposit(
      new BN(escrowAmount),
      new BN(vaultAuthorityBump),
      {
        accounts: {
          mint: mint,
          giver: giver.publicKey,
          taker: taker.publicKey,
          vaultAuthority: vaultAuthority,
          giverTokenAccount: giverTokenAccount,
          takerTokenAccount: takerTokenAccount,
          vaultTokenAccount: vaultTokenAccount.publicKey,
          escrowAccount: escrowAccount.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,   // needed? is not in original 
        },
        signers: [giver, escrowAccount, vaultTokenAccount],
      }
    );

    let _vaultTokenAccountA = await getAccount(provider.connection, vaultTokenAccount.publicKey);
    let _escrowAccount: EscrowAccount = await program.account.escrowAccount.fetch(escrowAccount.publicKey);

    // Validate new vault authority
    assert.ok(_vaultTokenAccountA.owner.equals(vaultAuthority));

    // Validate escrow account
    assert.ok(_escrowAccount.giverKey.equals(giver.publicKey));
    assert.ok(_escrowAccount.takerKey.equals(taker.publicKey));
    assert.equal(_escrowAccount.amount.toNumber(), escrowAmount);
    assert.equal(_escrowAccount.vaultAuthorityBump, vaultAuthorityBump);
    assert.ok(_escrowAccount.giverTokenAccount.equals(giverTokenAccount));
    assert.ok(! _escrowAccount.isReleased);
  });

  // it("Exchange escrow", async () => {
  //   await program.rpc.exchange({
  //     accounts: {
  //       taker: provider.wallet.publicKey,
  //       takerDepositTokenAccount: takerTokenAccountB,
  //       takerReceiveTokenAccount: takerTokenAccountA,
  //       pdaDepositTokenAccount: initializerTokenAccountA,
  //       initializerReceiveTokenAccount: initializerTokenAccountB,
  //       initializerMainAccount: provider.wallet.publicKey,
  //       escrowAccount: escrowAccount.publicKey,
  //       pdaAccount: pda,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //     },
  //   });

  //   let _takerTokenAccountA = await mintA.getAccountInfo(takerTokenAccountA);
  //   let _takerTokenAccountB = await mintB.getAccountInfo(takerTokenAccountB);
  //   let _initializerTokenAccountA = await mintA.getAccountInfo(initializerTokenAccountA);
  //   let _initializerTokenAccountB = await mintB.getAccountInfo(initializerTokenAccountB );

  //   // Check that the initializer gets back ownership of their token account.
  //   assert.ok(_takerTokenAccountA.owner.equals(provider.wallet.publicKey));

  //   assert.ok(_takerTokenAccountA.amount.toNumber() == initializerAmount);
  //   assert.ok(_initializerTokenAccountA.amount.toNumber() == initializerABalance - initializerAmount);
  //   assert.ok(_initializerTokenAccountB.amount.toNumber() == takerAmount);
  //   assert.ok(_takerTokenAccountB.amount.toNumber() == takerBBalance - takerAmount);
  // });

  // it("Initialize escrow and cancel escrow", async () => {
  //   let newEscrow = Keypair.generate();

  //   // Put back tokens into initializer token A account.
  //   await mintA.mintTo(
  //     initializerTokenAccountA,
  //     mintAuthority.publicKey,
  //     [mintAuthority],
  //     initializerAmount
  //   );

  //   await program.rpc.initializeEscrow(
  //     new BN(initializerAmount),
  //     new BN(takerAmount),
  //     {
  //       accounts: {
  //         initializer: provider.wallet.publicKey,
  //         initializerDepositTokenAccount: initializerTokenAccountA,
  //         initializerReceiveTokenAccount: initializerTokenAccountB,
  //         escrowAccount: newEscrow.publicKey,
  //         systemProgram: SystemProgram.programId,
  //         tokenProgram: TOKEN_PROGRAM_ID,
  //       },
  //       signers: [newEscrow],
  //     }
  //   );

  //   let _initializerTokenAccountA = await mintA.getAccountInfo(initializerTokenAccountA);

  //   // Check that the new owner is the PDA.
  //   assert.ok(_initializerTokenAccountA.owner.equals(pda));

  //   // Cancel the escrow.
  //   await program.rpc.cancelEscrow({
  //     accounts: {
  //       initializer: provider.wallet.publicKey,
  //       pdaDepositTokenAccount: initializerTokenAccountA,
  //       pdaAccount: pda,
  //       escrowAccount: newEscrow.publicKey,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //     },
  //   });

  //   // Check the final owner should be the provider public key.
  //   _initializerTokenAccountA = await mintA.getAccountInfo(initializerTokenAccountA);
  //   assert.ok(_initializerTokenAccountA.owner.equals(provider.wallet.publicKey));

  //   // Check all the funds are still there.
  //   assert.ok(_initializerTokenAccountA.amount.toNumber() == initializerABalance);
  // });
});





// QUESTIONS:
// - what exactly is a provider? What is provider wallet?
// - Error: Wrong input type for account "takerTokenAccount" in the instruction accounts object for instruction "deposit". Expected PublicKey or string.
// - rent - when needed?
// - error tracing onchain?
// - signing for only account creation?