import * as anchor from "@project-serum/anchor";
import { Program, BN, IdlAccounts } from "@project-serum/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";
import { Escrow } from "../target/types/escrow";

type EscrowAccount = IdlAccounts<Escrow>["escrowAccount"];

describe("escrow", () => {
  const provider = anchor.Provider.env();
  const program = anchor.workspace.Escrow as Program<Escrow>;
  const airdrop      = 1000000000;
  const giverBalance = 10000000;
  const escrowAmount = 100000;
  const bogusPublicKey = Keypair.generate().publicKey;

  type TestCtx = {
    giver?: anchor.web3.Keypair;
    taker?: anchor.web3.Keypair;
    mint?: PublicKey;
    mintAuthority?: anchor.web3.Keypair;
    vaultAuthority?: PublicKey;
    vaultAuthorityBump?: number;
    giverTokenAccount?: PublicKey;
    takerTokenAccount?: PublicKey;
    escrowAccount?: anchor.web3.Keypair;
    vaultTokenAccount?: anchor.web3.Keypair;
  }

  async function setup(): Promise<TestCtx> {
    let ctx: TestCtx = {};
    ctx.giver = Keypair.generate();
    ctx.taker = Keypair.generate();
    ctx.mintAuthority = Keypair.generate();
    ctx.escrowAccount = Keypair.generate();
    ctx.vaultTokenAccount = Keypair.generate();

    // Airdropping tokens to a giver/taker
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(ctx.giver.publicKey, airdrop),
      "confirmed"
    );

    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(ctx.taker.publicKey, airdrop),
      "confirmed"
    );

    // mint holds token metadata
    ctx.mint = await createMint(provider.connection, ctx.giver, ctx.mintAuthority.publicKey, null, 0);

    ctx.giverTokenAccount = await createAccount(provider.connection, ctx.giver, ctx.mint, ctx.giver.publicKey);
    ctx.takerTokenAccount = await createAccount(provider.connection, ctx.taker, ctx.mint, ctx.taker.publicKey);

    await mintTo(provider.connection, ctx.giver, ctx.mint, ctx.giverTokenAccount, ctx.mintAuthority, giverBalance);

    const [_pda, _bumpSeed] = await PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("escrow"))],
      program.programId
    );

    ctx.vaultAuthority = _pda;
    ctx.vaultAuthorityBump = _bumpSeed;

    return ctx;
  }

  ///////////////////// Tests /////////////////////

  it("Deposit into escrow", async () => {
    const ctx = await setup();
    await program.rpc.deposit(
      {
        amount: new BN(escrowAmount),
        vaultAuthorityBump: new BN(ctx.vaultAuthorityBump),
      },
      {
        accounts: {
          mint: ctx.mint,
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          vaultAuthority: ctx.vaultAuthority,
          giverTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount.publicKey,
          escrowAccount: ctx.escrowAccount.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [ctx.giver, ctx.escrowAccount, ctx.vaultTokenAccount],
      }
    );

    let _vaultTokenAccountA = await getAccount(provider.connection, ctx.vaultTokenAccount.publicKey);
    let _escrowAccount: EscrowAccount = await program.account.escrowAccount.fetch(ctx.escrowAccount.publicKey);

    // Validate new vault authority
    assert.ok(_vaultTokenAccountA.owner.equals(ctx.vaultAuthority));

    // Validate escrow account
    assert.ok(_escrowAccount.giverKey.equals(ctx.giver.publicKey));
    assert.ok(_escrowAccount.takerKey.equals(ctx.taker.publicKey));
    assert.equal(_escrowAccount.amount.toNumber(), escrowAmount);
    assert.equal(_escrowAccount.vaultAuthorityBump, ctx.vaultAuthorityBump);
    assert.ok(! _escrowAccount.isReleased);
  });

  it("Release escrow funds", async () => {
    const ctx = await setup();

    await program.rpc.deposit(
      {
        amount: new BN(escrowAmount),
        vaultAuthorityBump: new BN(ctx.vaultAuthorityBump),
      },
      {
        accounts: {
          mint: ctx.mint,
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          vaultAuthority: ctx.vaultAuthority,
          giverTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount.publicKey,
          escrowAccount: ctx.escrowAccount.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [ctx.giver, ctx.escrowAccount, ctx.vaultTokenAccount],
      }
    );

    await program.rpc.release(
      {
        accounts: {
          giver: ctx.giver.publicKey,
          escrowAccount: ctx.escrowAccount.publicKey,
        },
        signers: [ctx.giver],
      }
    );

    let _escrowAccount: EscrowAccount = await program.account.escrowAccount.fetch(ctx.escrowAccount.publicKey);

    // Validate new vault authority
    assert.ok(_escrowAccount.isReleased);
  });

  it("Withdraw escrow funds", async () => {
    const ctx = await setup();

    await program.rpc.deposit(
      {
        amount: new BN(escrowAmount),
        vaultAuthorityBump: new BN(ctx.vaultAuthorityBump),
      },
      {
        accounts: {
          mint: ctx.mint,
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          vaultAuthority: ctx.vaultAuthority,
          giverTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount.publicKey,
          escrowAccount: ctx.escrowAccount.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [ctx.giver, ctx.escrowAccount, ctx.vaultTokenAccount],
      }
    );

    await program.rpc.release(
      {
        accounts: {
          giver: ctx.giver.publicKey,
          escrowAccount: ctx.escrowAccount.publicKey,
        },
        signers: [ctx.giver],
      }
    );

    await program.rpc.withdraw(
      {
        accounts: {
          mint: ctx.mint,
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          takerTokenAccount: ctx.takerTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount.publicKey,
          escrowAccount: ctx.escrowAccount.publicKey,
          vaultAuthority: ctx.vaultAuthority,
          tokenProgram: TOKEN_PROGRAM_ID,
        }
      }
    );

    // validate transferred amount
    let _giverTokenAccount = await getAccount(provider.connection, ctx.giverTokenAccount);
    assert.equal(_giverTokenAccount.amount, giverBalance - escrowAmount);
    let _takerTokenAccount = await getAccount(provider.connection, ctx.takerTokenAccount);
    assert.equal(_takerTokenAccount.amount, escrowAmount);

    // validate accounts no longer exist - FIXME: there must be a nicer way...
    expectError(async () => getAccount(provider.connection, ctx.vaultTokenAccount.publicKey) , 'TokenAccountNotFoundError');
    expectError(async () => getAccount(provider.connection, ctx.escrowAccount.publicKey),      'TokenAccountNotFoundError');
  });

  it("Cancels escrow", async () => {
    const ctx = await setup();

    await program.rpc.deposit(
      {
        amount: new BN(escrowAmount),
        vaultAuthorityBump: new BN(ctx.vaultAuthorityBump),
      },
      {
        accounts: {
          mint: ctx.mint,
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          vaultAuthority: ctx.vaultAuthority,
          giverTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount.publicKey,
          escrowAccount: ctx.escrowAccount.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [ctx.giver, ctx.escrowAccount, ctx.vaultTokenAccount],
      }
    );

    await program.rpc.cancel(
      {
        accounts: {
          mint: ctx.mint,
          giver: ctx.giver.publicKey,
          refundTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount.publicKey,
          escrowAccount: ctx.escrowAccount.publicKey,
          vaultAuthority: ctx.vaultAuthority,
          tokenProgram: TOKEN_PROGRAM_ID,
        }
      }
    );

    // validate transferred amount
    let _giverTokenAccount = await getAccount(provider.connection, ctx.giverTokenAccount);
    assert.equal(_giverTokenAccount.amount, giverBalance);
    let _takerTokenAccount = await getAccount(provider.connection, ctx.takerTokenAccount);
    assert.equal(_takerTokenAccount.amount, 0);

    // validate accounts no longer exist - FIXME: there must be a nicer way...
    expectError(async () => getAccount(provider.connection, ctx.vaultTokenAccount.publicKey) , 'TokenAccountNotFoundError');
    expectError(async () => getAccount(provider.connection, ctx.escrowAccount.publicKey) , 'TokenAccountNotFoundError');
  });

  it("Release and cancels failure", async () => {
    const ctx = await setup();

    await program.rpc.deposit(
      {
        amount: new BN(escrowAmount),
        vaultAuthorityBump: new BN(ctx.vaultAuthorityBump),
      },
      {
        accounts: {
          mint: ctx.mint,
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          vaultAuthority: ctx.vaultAuthority,
          giverTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount.publicKey,
          escrowAccount: ctx.escrowAccount.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [ctx.giver, ctx.escrowAccount, ctx.vaultTokenAccount],
      }
    );

    await program.rpc.release(
      {
        accounts: {
          giver: ctx.giver.publicKey,
          escrowAccount: ctx.escrowAccount.publicKey,
        },
        signers: [ctx.giver],
      }
    );
    
    await expectError(async () => {
      await program.rpc.cancel(
        {
          accounts: {
            mint: ctx.mint,
            giver: ctx.giver.publicKey,
            refundTokenAccount: ctx.giverTokenAccount,
            vaultTokenAccount: ctx.vaultTokenAccount.publicKey,
            escrowAccount: ctx.escrowAccount.publicKey,
            vaultAuthority: ctx.vaultAuthority,
            tokenProgram: TOKEN_PROGRAM_ID,
          }
        }
      )}, `6000: Attempted cancel after release`);
  });

  it("Deposit failure - bogus mint", async () => {
    const ctx = await setup();

    // use incorrect mint
    await expectError(async () => {
      await program.rpc.deposit(
        {
          amount: new BN(escrowAmount),
          vaultAuthorityBump: new BN(ctx.vaultAuthorityBump),
        },
        {
          accounts: {
            mint: bogusPublicKey,
            giver: ctx.giver.publicKey,
            taker: ctx.taker.publicKey,
            vaultAuthority: ctx.vaultAuthority,
            giverTokenAccount: ctx.giverTokenAccount,
            vaultTokenAccount: ctx.vaultTokenAccount.publicKey,
            escrowAccount: ctx.escrowAccount.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          },
          signers: [ctx.giver, ctx.escrowAccount, ctx.vaultTokenAccount],
        }
      );
    }, `3012: The program expected this account to be already initialized`);
  });

  it("Deposit failure - bogus vaultAuthority", async () => {
    const ctx = await setup();

    // use non pda vaultAuthority
    await expectError(async () => {
      await program.rpc.deposit(
        {
          amount: new BN(escrowAmount),
          vaultAuthorityBump: new BN(ctx.vaultAuthorityBump),
        },
        {
          accounts: {
            mint: ctx.mint,
            giver: ctx.giver.publicKey,
            taker: ctx.taker.publicKey,
            vaultAuthority: bogusPublicKey,
            giverTokenAccount: ctx.giverTokenAccount,
            vaultTokenAccount: ctx.vaultTokenAccount.publicKey,
            escrowAccount: ctx.escrowAccount.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          },
          signers: [ctx.giver, ctx.escrowAccount, ctx.vaultTokenAccount],
        }
      );
    }, `2006: A seeds constraint was violated`);
  });

  it("Deposit failure - empty giver account", async () => {
    const ctx = await setup();
    await sleep(1000);
    // use empty (no tokens) giver token account
    let emptyTokenAccount = await createAccount(provider.connection, ctx.giver, ctx.mint, ctx.giver.publicKey, Keypair.generate());
    await mintTo(provider.connection, ctx.giver, ctx.mint, emptyTokenAccount, ctx.mintAuthority, 100);

    await expectError(async () => {
      await program.rpc.deposit(
        {
          amount: new BN(escrowAmount),
          vaultAuthorityBump: new BN(ctx.vaultAuthorityBump),
        },
        {
          accounts: {
            mint: ctx.mint,
            giver: ctx.giver.publicKey,
            taker: ctx.taker.publicKey,
            vaultAuthority: ctx.vaultAuthority,
            giverTokenAccount: emptyTokenAccount,
            vaultTokenAccount: ctx.vaultTokenAccount.publicKey,
            escrowAccount: ctx.escrowAccount.publicKey,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          },
          signers: [ctx.giver, ctx.escrowAccount, ctx.vaultTokenAccount],
        }
      );
    }, `6003: Insufficient deposit amount`);
  });

  it("Release failures", async () => {
    const ctx = await setup();
    const bogusWallet = Keypair.generate();

    await program.rpc.deposit(
      {
        amount: new BN(escrowAmount),
        vaultAuthorityBump: new BN(ctx.vaultAuthorityBump),
      },
      {
        accounts: {
          mint: ctx.mint,
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          vaultAuthority: ctx.vaultAuthority,
          giverTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount.publicKey,
          escrowAccount: ctx.escrowAccount.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [ctx.giver, ctx.escrowAccount, ctx.vaultTokenAccount],
      }
    );

    // using wallet that wasn't used in deposit
    await expectError(async () => {
      await program.rpc.release(
        {
          accounts: {
            giver: bogusWallet.publicKey,
            escrowAccount: ctx.escrowAccount.publicKey,
          },
          signers: [bogusWallet],
        }
      );
    }, `2003: A raw constraint was violated`);
  });

  // it("Cancel failures", async () => {
  //   throw Error("unimplemented!")
  // });

  // it("Withdraw failures", async () => {
  //   throw Error("unimplemented!")
  // });

});


///////////////////// Utils /////////////////////
async function expectError(fn: Function, errorMsg: String) {
  try {
    await fn();
    assert.fail(`Unexpected success of ${fn}, expected error message: ${errorMsg}`)
  } catch (err: any) {
    assert.equal(err.message, errorMsg, `Unexpected error message`)
  }
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms, undefined));
}