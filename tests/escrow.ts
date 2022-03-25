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

  let nonce = 0;

  type TestCtx = {
    giver?: anchor.web3.Keypair;
    taker?: anchor.web3.Keypair;
    mint?: PublicKey;
    nonce?: number;
    mintAuthority?: anchor.web3.Keypair;
    escrowAccountBump?: number;
    vaultTokenAccountBump?: number;
    giverTokenAccount?: PublicKey;
    takerTokenAccount?: PublicKey;
    escrowAccount?: PublicKey;
    vaultTokenAccount?: PublicKey;
  }

  async function setup(): Promise<TestCtx> {
    let ctx: TestCtx = {};
    ctx.giver = Keypair.generate();
    ctx.taker = Keypair.generate();
    ctx.mintAuthority = Keypair.generate();

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

    const [_escrowPda, _escrowBump] = await PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("escrow")), new anchor.BN(nonce).toArrayLike(Buffer, "le", 8), ctx.giver.publicKey.toBuffer()],
      program.programId
    );

    const [_vaultTokenPda, _vaultTokenBump] = await PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("escrow_vault_token")), _escrowPda.toBuffer()],
      program.programId
    );

    ctx.escrowAccount = _escrowPda;
    ctx.escrowAccountBump = _escrowBump;
    ctx.vaultTokenAccount = _vaultTokenPda;
    ctx.vaultTokenAccountBump = _vaultTokenBump;

    ctx.nonce = nonce;
    nonce += 1;

    return ctx;
  }

  ///////////////////// Tests /////////////////////

  it("Deposit into escrow", async () => {
    const ctx = await setup();
    await program.rpc.deposit(
      {
        nonce: new BN(ctx.nonce),
        amount: new BN(escrowAmount),
        escrowAccountBump: ctx.escrowAccountBump,
        vaultTokenAccountBump: ctx.vaultTokenAccountBump,
      },
      {
        accounts: {
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          mint: ctx.mint,
          escrowAccount: ctx.escrowAccount,
          giverTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [ctx.giver],
      }
    );

    let _vaultTokenAccount = await getAccount(provider.connection, ctx.vaultTokenAccount);
    let _escrowAccount: EscrowAccount = await program.account.escrowAccount.fetch(ctx.escrowAccount);

    // Validate escrow account
    assert.ok(_escrowAccount.giverKey.equals(ctx.giver.publicKey));
    assert.ok(_escrowAccount.takerKey.equals(ctx.taker.publicKey));
    assert.ok(_escrowAccount.mintKey.equals(ctx.mint));
    assert.equal(_escrowAccount.amount.toNumber(), escrowAmount);
    assert.equal(_escrowAccount.escrowAccountBump, ctx.escrowAccountBump);
    assert.equal(_escrowAccount.vaultTokenAccountBump, ctx.vaultTokenAccountBump);
    assert.ok(! _escrowAccount.isReleased);
  });

  it("Release escrow funds", async () => {
    const ctx = await setup();
    await program.rpc.deposit(
      {
        nonce: new BN(ctx.nonce),
        amount: new BN(escrowAmount),
        escrowAccountBump: ctx.escrowAccountBump,
        vaultTokenAccountBump: ctx.vaultTokenAccountBump,
      },
      {
        accounts: {
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          mint: ctx.mint,
          escrowAccount: ctx.escrowAccount,
          giverTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [ctx.giver],
      }
    );

    await program.rpc.release(
      {
        accounts: {
          giver: ctx.giver.publicKey,
          escrowAccount: ctx.escrowAccount,
        },
        signers: [ctx.giver],
      }
    );

    let _escrowAccount: EscrowAccount = await program.account.escrowAccount.fetch(ctx.escrowAccount);

    // Validate new vault authority
    assert.ok(_escrowAccount.isReleased);
  });

  it("Withdraw escrow funds", async () => {
    const ctx = await setup();
    await program.rpc.deposit(
      {
        nonce: new BN(ctx.nonce),
        amount: new BN(escrowAmount),
        escrowAccountBump: ctx.escrowAccountBump,
        vaultTokenAccountBump: ctx.vaultTokenAccountBump,
      },
      {
        accounts: {
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          mint: ctx.mint,
          escrowAccount: ctx.escrowAccount,
          giverTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [ctx.giver],
      }
    );

    await program.rpc.release(
      {
        accounts: {
          giver: ctx.giver.publicKey,
          escrowAccount: ctx.escrowAccount,
        },
        signers: [ctx.giver],
      }
    );

    await program.rpc.withdraw(
      {
        accounts: {
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          takerTokenAccount: ctx.takerTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount,
          escrowAccount: ctx.escrowAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
      }
    );

    // validate transferred amount
    let _giverTokenAccount = await getAccount(provider.connection, ctx.giverTokenAccount);
    assert.equal(_giverTokenAccount.amount, giverBalance - escrowAmount);
    let _takerTokenAccount = await getAccount(provider.connection, ctx.takerTokenAccount);
    assert.equal(_takerTokenAccount.amount, escrowAmount);

    // validate accounts no longer exist - FIXME: there must be a nicer way...
    expectError(async () => getAccount(provider.connection, ctx.vaultTokenAccount), 'TokenAccountNotFoundError');
    expectError(async () => getAccount(provider.connection, ctx.escrowAccount),     'TokenAccountNotFoundError');
  });

  it("Cancels escrow", async () => {
    const ctx = await setup();
    await program.rpc.deposit(
      {
        nonce: new BN(ctx.nonce),
        amount: new BN(escrowAmount),
        escrowAccountBump: ctx.escrowAccountBump,
        vaultTokenAccountBump: ctx.vaultTokenAccountBump,
      },
      {
        accounts: {
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          mint: ctx.mint,
          escrowAccount: ctx.escrowAccount,
          giverTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [ctx.giver],
      }
    );

    await program.rpc.cancel(
      {
        accounts: {
          giver: ctx.giver.publicKey,
          refundTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount,
          escrowAccount: ctx.escrowAccount,
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
    expectError(async () => getAccount(provider.connection, ctx.vaultTokenAccount) , 'TokenAccountNotFoundError');
    expectError(async () => getAccount(provider.connection, ctx.escrowAccount) ,     'TokenAccountNotFoundError');
  });

  it("Release and cancels failure", async () => {
    const ctx = await setup();
    await program.rpc.deposit(
      {
        nonce: new BN(ctx.nonce),
        amount: new BN(escrowAmount),
        escrowAccountBump: ctx.escrowAccountBump,
        vaultTokenAccountBump: ctx.vaultTokenAccountBump,
      },
      {
        accounts: {
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          mint: ctx.mint,
          escrowAccount: ctx.escrowAccount,
          giverTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [ctx.giver],
      }
    );

    await program.rpc.release(
      {
        accounts: {
          giver: ctx.giver.publicKey,
          escrowAccount: ctx.escrowAccount,
        },
        signers: [ctx.giver],
      }
    );
    
    await expectError(async () => {
      await program.rpc.cancel(
        {
          accounts: {
            giver: ctx.giver.publicKey,
            refundTokenAccount: ctx.giverTokenAccount,
            vaultTokenAccount: ctx.vaultTokenAccount,
            escrowAccount: ctx.escrowAccount,
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
            nonce: new BN(ctx.nonce),
            amount: new BN(escrowAmount),
            escrowAccountBump: ctx.escrowAccountBump,
            vaultTokenAccountBump: ctx.vaultTokenAccountBump,
          },
          {
            accounts: {
              giver: ctx.giver.publicKey,
              taker: ctx.taker.publicKey,
              mint: bogusPublicKey,
              escrowAccount: ctx.escrowAccount,
              giverTokenAccount: ctx.giverTokenAccount,
              vaultTokenAccount: ctx.vaultTokenAccount,
              systemProgram: SystemProgram.programId,
              tokenProgram: TOKEN_PROGRAM_ID,
              rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            },
            signers: [ctx.giver],
          }
        );
      }, `3012: The program expected this account to be already initialized`);
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
          nonce: new BN(ctx.nonce),
          amount: new BN(escrowAmount),
          escrowAccountBump: ctx.escrowAccountBump,
          vaultTokenAccountBump: ctx.vaultTokenAccountBump,
        },
        {
          accounts: {
            giver: ctx.giver.publicKey,
            taker: ctx.taker.publicKey,
            mint: ctx.mint,
            escrowAccount: ctx.escrowAccount,
            giverTokenAccount: emptyTokenAccount,
            vaultTokenAccount: ctx.vaultTokenAccount,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          },
          signers: [ctx.giver],
        }
      );
    }, `6003: Insufficient deposit amount`);
  });

  it("Release failures", async () => {
    const ctx = await setup();
    const bogusWallet = Keypair.generate();

    await program.rpc.deposit(
      {
        nonce: new BN(ctx.nonce),
        amount: new BN(escrowAmount),
        escrowAccountBump: ctx.escrowAccountBump,
        vaultTokenAccountBump: ctx.vaultTokenAccountBump,
      },
      {
        accounts: {
          giver: ctx.giver.publicKey,
          taker: ctx.taker.publicKey,
          mint: ctx.mint,
          escrowAccount: ctx.escrowAccount,
          giverTokenAccount: ctx.giverTokenAccount,
          vaultTokenAccount: ctx.vaultTokenAccount,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        },
        signers: [ctx.giver],
      }
    );

    // using wallet that wasn't used in deposit
    await expectError(async () => {
      await program.rpc.release(
        {
          accounts: {
            giver: bogusWallet.publicKey,
            escrowAccount: ctx.escrowAccount,
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