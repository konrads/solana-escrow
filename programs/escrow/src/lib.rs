use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

declare_id!("HG6eAHrTi1WM4QtC9taAiVexvFfDyWbZPCYXNXy5zn4A");

#[error]
pub enum ErrorCode {
    #[msg("Attempted cancel after release")]
    CancelReleasedAccountError,
    #[msg("Unexpected mints provided for accounts")]
    UnexpectedMintError,
    #[msg("Unexpected vault authorities provided for vault account")]
    UnexpectedVaultAuthorityError,
    #[msg("Insufficient deposit amount")]
    InsufficientDepositAmountError,
    #[msg("Account not owned by giver")]
    NonGiverAccountError,
}
use ErrorCode::*;

const ESCROW_PDA_SEED: &[u8] = b"escrow";
const VAULT_TOKEN_PDA_SEED: &[u8] = b"escrow_vault_token";

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct DepositArgs {
    pub amount: u64,
    pub vault_token_account_bump: u8,
    pub escrow_account_bump: u8,
}

#[program]
pub mod escrow {
    use super::*;

    /// Deposit and lock the funds by:
    /// - populate escrow account state
    /// - set vault_token_account authority to PDA
    /// - transfer funds from giver_token_account to vault_token_account
    pub fn deposit(ctx: Context<Deposit>, args: DepositArgs) -> ProgramResult {
        let Deposit { giver, taker, giver_token_account, vault_token_account, token_program, escrow_account, mint, .. } = ctx.accounts;
        
        escrow_account.mint = *mint.to_account_info().key;
        escrow_account.giver_key = *giver.key;
        escrow_account.taker_key = *taker.key;
        escrow_account.refund_token_account = *giver_token_account.to_account_info().key;
        escrow_account.amount = args.amount;
        escrow_account.escrow_account_bump = args.escrow_account_bump;
        escrow_account.vault_token_account_bump = args.vault_token_account_bump;
        escrow_account.is_released = false;

        // transfer the token to vault_account
        token::transfer(
            CpiContext::new(
                token_program.to_account_info(),
                Transfer { from: giver_token_account.to_account_info(), to: vault_token_account.to_account_info(), authority: giver.to_account_info() },
            ),
            args.amount
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
        let Cancel { giver, refund_token_account, vault_token_account, token_program, escrow_account, .. } = ctx.accounts;
        if escrow_account.is_released {
            return Err(ErrorCode::CancelReleasedAccountError.into())
        }

        let authority_seeds = &[&VAULT_TOKEN_PDA_SEED[..], &[escrow_account.vault_token_account_bump]];

        token::transfer(
            CpiContext::new(
                token_program.clone(),
                Transfer {
                    from:      vault_token_account.to_account_info().clone(),
                    to:        refund_token_account.to_account_info().clone(),
                    authority: escrow_account.to_account_info(),
                }
            ).with_signer(&[&authority_seeds[..]]),
            escrow_account.amount
        )?;
        token::close_account(
            CpiContext::new(
                token_program.clone(),
                CloseAccount {
                    account:     vault_token_account.to_account_info().clone(),
                    destination: giver.clone(),
                    authority:   escrow_account.to_account_info(),
                }
            ).with_signer(&[&authority_seeds[..]])
        )?;

        Ok(())
    }

    /// Release the funds back to giver via:
    /// - transfer funds to taker
    /// - close the vault_token_account and escrow_account
    pub fn withdraw(ctx: Context<Withdraw>) -> ProgramResult {
        let Withdraw { giver, taker_token_account, vault_token_account, token_program, escrow_account, .. } = ctx.accounts;
        let authority_seeds = &[&VAULT_TOKEN_PDA_SEED[..], &[escrow_account.vault_token_account_bump]];

        token::transfer(
            CpiContext::new(
                token_program.to_account_info(),
                Transfer {
                    from:      vault_token_account.to_account_info().clone(),
                    to:        taker_token_account.to_account_info().clone(),
                    authority: escrow_account.to_account_info(),
                }
            ).with_signer(&[&authority_seeds[..]]),
            escrow_account.amount
        )?;
        token::close_account(
            CpiContext::new(
                token_program.to_account_info(),
                CloseAccount {
                    account:     vault_token_account.to_account_info().clone(),
                    destination: giver.clone(),
                    authority:   escrow_account.to_account_info(),
                }
            ).with_signer(&[&authority_seeds[..]]),
        )?;

        Ok(())
    }
}

#[account]
#[derive(Default)]
pub struct EscrowAccount {
    pub giver_key: Pubkey,
    pub taker_key: Pubkey,
    pub refund_token_account: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub escrow_account_bump: u8,
    pub vault_token_account_bump: u8,
    pub is_released: bool,
}

#[derive(Accounts)]
#[instruction(args: DepositArgs)]
pub struct Deposit<'info> {
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub giver: Signer<'info>,
    pub taker: AccountInfo<'info>,
    #[account(
        mut,
        constraint = giver_token_account.mint == mint.key() @ UnexpectedMintError,
        constraint = giver_token_account.owner == giver.key() @ NonGiverAccountError,
        constraint = giver_token_account.amount >= args.amount @ InsufficientDepositAmountError,
    )]
    pub giver_token_account: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = giver,
        token::mint = mint,
        token::authority = escrow_account,
        seeds = [VAULT_TOKEN_PDA_SEED, escrow_account.key().to_bytes().as_ref()],
        bump = args.vault_token_account_bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = giver,
        seeds = [ESCROW_PDA_SEED, giver.key().to_bytes().as_ref()],
        bump = args.escrow_account_bump
    )]
    pub escrow_account: Account<'info, EscrowAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(signer)]
    pub giver: AccountInfo<'info>,
    #[account(mut, constraint = escrow_account.giver_key == giver.key())]
    pub escrow_account: Account<'info, EscrowAccount>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut)]
    pub giver: AccountInfo<'info>,
    #[account(
        mut,
        constraint = refund_token_account.mint == escrow_account.mint.key(),
    )]
    pub refund_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vault_token_account.mint == escrow_account.mint.key() @ UnexpectedMintError,
        constraint = vault_token_account.owner == escrow_account.key() @ UnexpectedVaultAuthorityError,
        seeds = [VAULT_TOKEN_PDA_SEED, escrow_account.key().to_bytes().as_ref()],
        bump = escrow_account.vault_token_account_bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = escrow_account.giver_key == giver.key(),
        constraint = escrow_account.refund_token_account == refund_token_account.key(),
        seeds = [ESCROW_PDA_SEED, giver.key().to_bytes().as_ref()],
        bump = escrow_account.escrow_account_bump,
        close = giver
    )]
    pub escrow_account: Account<'info, EscrowAccount>,
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub giver: AccountInfo<'info>,
    #[account()]
    pub taker: AccountInfo<'info>,
    #[account(mut, constraint = taker_token_account.mint == escrow_account.mint.key())]
    pub taker_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vault_token_account.mint == escrow_account.mint.key() @ UnexpectedMintError,
        constraint = vault_token_account.owner == escrow_account.key() @ UnexpectedVaultAuthorityError,
        seeds = [VAULT_TOKEN_PDA_SEED, escrow_account.key().to_bytes().as_ref()],
        bump = escrow_account.vault_token_account_bump
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = escrow_account.is_released,
        constraint = escrow_account.taker_key == *taker.key,
        constraint = escrow_account.giver_key == *giver.key,
        seeds = [ESCROW_PDA_SEED, giver.key().to_bytes().as_ref()],
        bump = escrow_account.escrow_account_bump,
        close = giver
    )]
    pub escrow_account: Account<'info, EscrowAccount>,
    pub token_program: Program<'info, Token>,
}
