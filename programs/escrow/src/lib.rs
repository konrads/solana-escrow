use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

declare_id!("HG6eAHrTi1WM4QtC9taAiVexvFfDyWbZPCYXNXy5zn4A");

#[error]
pub enum ErrorCode {
    #[msg("Attempted cancel after release")]
    CancelReleasedAccountError,
    #[msg("Example error")]
    ExampleError,
}

const ESCROW_PDA_SEED: &[u8] = b"escrow";

#[program]
pub mod escrow {
    use super::*;

    /// Deposit and lock the funds by:
    /// - populate escrow account state
    /// - set vault_token_account authority to PDA
    /// - transfer funds from giver_token_account to vault_token_account
    // Note: not sure if still the case, but there is a weird serialization issue with Borsh
    // sometimes that makes some instruction data fail to properly serialize when passed in like
    // so.
    // As such, I tend to prefer making our instructions pass in a struct (which serializses properly),
    // especially when there are alot of arguments.
    // i.e. Args {
    // bump : u8,
    // amount: u64
    // }
    pub fn deposit(ctx: Context<Deposit>, amount: u64, vault_authority_bump: u8) -> ProgramResult {
        let Deposit {
            giver,
            taker,
            giver_token_account,
            vault_token_account,
            token_program,
            escrow_account,
            ..
        } = ctx.accounts;

        escrow_account.giver_key = *giver.key;
        escrow_account.taker_key = *taker.key;
        escrow_account.giver_token_account = *giver_token_account.to_account_info().key;
        escrow_account.amount = amount;
        escrow_account.vault_authority_bump = vault_authority_bump;
        escrow_account.is_released = false;

        // transfer the token to vault_account
        token::transfer(
            CpiContext::new(
                token_program.to_account_info().clone(),
                Transfer {
                    from: giver_token_account.to_account_info(),
                    to: vault_token_account.to_account_info(),
                    authority: giver.to_account_info().clone(),
                },
            ),
            amount,
        )?;

        Ok(())
    }

    /// Flag the escrow_account as released.
    pub fn release(ctx: Context<Release>) -> ProgramResult {
        ctx.accounts.escrow_account.is_released = true;
        Ok(())
    }

    /// Release the funds back to giver via:
    /// - transfer funds back to giver
    /// - close the vault_token_account and escrow_account
    pub fn cancel(ctx: Context<Cancel>) -> ProgramResult {
        if ctx.accounts.escrow_account.is_released {
            return Err(ErrorCode::CancelReleasedAccountError.into());
        }

        let authority_seeds = &[
            &ESCROW_PDA_SEED[..],
            &[ctx.accounts.escrow_account.vault_authority_bump],
        ];

        token::transfer(
            ctx.accounts
                .into_transfer_context() // Nice way to abstract out some boilerplate logic outside of the business logic.
                .with_signer(&[&authority_seeds[..]]), // needed as vault_pda wasn't used as signer // This is needed because the vault_pda owns the token account.
            ctx.accounts.escrow_account.amount,
        )?;

        token::close_account(
            ctx.accounts
                .into_close_context() // Ditto.
                .with_signer(&[&authority_seeds[..]]),
        )?;

        Ok(())
    }

    /// Release the funds back to giver via:
    /// - transfer funds to taker
    /// - close the vault_token_account and escrow_account
    pub fn withdraw(ctx: Context<Withdraw>) -> ProgramResult {
        let Withdraw {
            giver,
            taker_token_account,
            vault_token_account,
            vault_authority,
            token_program,
            escrow_account,
            ..
        } = ctx.accounts;
        let authority_seeds = &[&ESCROW_PDA_SEED[..], &[escrow_account.vault_authority_bump]];

        token::transfer(
            CpiContext::new(
                token_program.clone(),
                Transfer {
                    from: vault_token_account.to_account_info().clone(),
                    to: taker_token_account.to_account_info().clone(),
                    authority: vault_authority.clone(),
                },
            )
            .with_signer(&[&authority_seeds[..]]),
            escrow_account.amount,
        )?;
        token::close_account(
            CpiContext::new(
                token_program.clone(),
                CloseAccount {
                    account: vault_token_account.to_account_info().clone(),
                    destination: giver.clone(),
                    authority: vault_authority.clone(),
                },
            )
            .with_signer(&[&authority_seeds[..]]),
        )?;

        Ok(())
    }
}

#[account]
#[derive(Default)]
pub struct EscrowAccount {
    pub giver_key: Pubkey,
    pub taker_key: Pubkey,
    pub giver_token_account: Pubkey, // Don't think we actually need to store this. As long as the future giver_token_account is owned by the giver_key, should be ok?.
    // I think storing the mint is probably good enough, though if the vault_token_account was a
    // PDA derived from escrow account, you could also check the mint metadata (in which case
    // storing mint is unnecessary as well).
    pub amount: u64,
    // I think fine here, but probably more standard to store the global PDA bump seed
    //  in another global account i.e. some State account that stores all smart contract global variables
    //  So you don't need to have this u8 per escrow.
    //  Alternatively, you could make the *vault_authority* pda unique to each escrow account, i.e.
    //  using escrow account as a seed to the PDA. Some can claim this is *safer* as you don't have
    //  the same PDA owning all escrow token accounts, but I think that is generally fine.
    pub vault_authority_bump: u8,
    pub is_released: bool,
}

#[derive(Accounts)]
#[instruction(amount: u64, vault_authority_bump: u8)]
pub struct Deposit<'info> {
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub giver: Signer<'info>, // I think more common practice to just mark signer like so.
    pub taker: AccountInfo<'info>,
    #[account(
        seeds = [ESCROW_PDA_SEED],
        bump = vault_authority_bump
    )]
    pub vault_authority: AccountInfo<'info>,
    // I think it is best practice to be as verbose with constraints as possible so this is good.
    // But it is useful to note that if giver_token_account was not of the Mint account mint, the
    // instruction would fail at the transfer CPI, rather than here.
    #[account(
        mut,
        constraint = giver_token_account.mint == mint.key() && giver_token_account.amount >= amount,
        constraint = giver_token_account.owner == giver.key(),
    )]
    pub giver_token_account: Account<'info, TokenAccount>,
    #[account(
        constraint = taker_token_account.mint == mint.key() @ ErrorCode::ExampleError, // This is nice to have custom errors on constraints rather than the generic anchor constraints error.
        constraint = giver_token_account.owner == taker.key(),
    )]
    // We don't need this - I don't think the giver requires information about the taker's token
    // account at the time of creating the escrow - just the taker's key is enough.
    pub taker_token_account: Account<'info, TokenAccount>,
    // I think it would be best for this vault_token_account to be deterministically found w.r.t
    // the escrow account say and use escrow account as seed.
    #[account(init, payer = giver, token::mint = mint, token::authority = vault_authority)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(init, payer = giver)]
    pub escrow_account: Account<'info, EscrowAccount>,
    // Safest and best practice to check program ids this way.
    // There have been exploits where invalid program was passed into the instruction.
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    pub giver: Signer<'info>,
    #[account(mut, constraint = escrow_account.giver_key == giver.key())]
    // Add custom error for failure
    pub escrow_account: Account<'info, EscrowAccount>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    // If we stored mint in escrow account or
    // the vault_token_account was a PDA of the escrow itself, we wouldn't need to pass in mint
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub giver: Signer<'info>, // Without signer, anyone can cancel on the giver's behalf
    #[account(
        mut,
        constraint = giver_token_account.mint == mint.key(), 
        constraint = giver_token_account.owner == giver.key(), // Good check to have..
    )]
    // Since you do store giver_token_account - you probably would want to check this against the
    // one stored in escrow account, though it doesn't seem to matter.
    pub giver_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vault_token_account.mint == mint.key(),
        constraint = giver_token_account.owner == vault_authority.key(),
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = escrow_account.giver_key == giver.key(),
        constraint = escrow_account.giver_token_account == giver_token_account.key(),
        close = giver
    )]
    pub escrow_account: Account<'info, EscrowAccount>,
    #[account(
        seeds = [b"escrow"],
        bump = escrow_account.vault_authority_bump
    )]
    pub vault_authority: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub giver: AccountInfo<'info>,
    pub taker: Signer<'info>, // taker should be signer
    #[account(mut, constraint = taker_token_account.mint == mint.key())] // Should check owner
    pub taker_token_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_token_account.mint == mint.key())] // Check owner
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = escrow_account.is_released,
        constraint = escrow_account.taker_key == *taker.key,
        constraint = escrow_account.giver_key == *giver.key,
        close = giver
    )]
    pub escrow_account: Account<'info, EscrowAccount>,
    #[account(
        seeds = [b"escrow"],
        bump = escrow_account.vault_authority_bump
    )]
    pub vault_authority: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>, // Program check.
}

impl<'info> Cancel<'info> {
    pub fn into_transfer_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.vault_token_account.to_account_info().clone(),
            to: self.giver_token_account.to_account_info().clone(),
            authority: self.vault_authority.clone(),
        };
        CpiContext::new(self.token_program.to_account_info().clone(), cpi_accounts)
    }

    pub fn into_close_context(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let cpi_accounts = CloseAccount {
            account: self.vault_token_account.to_account_info().clone(),
            destination: self.giver.to_account_info().clone(),
            authority: self.vault_authority.clone(),
        };
        CpiContext::new(self.token_program.to_account_info().clone(), cpi_accounts)
    }
}
