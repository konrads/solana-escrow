use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, SetAuthority, TokenAccount, Transfer};
use spl_token::instruction::AuthorityType;

declare_id!("Bmn7S2JbiENi9ypnu6Dkpe9myNTzwBi3cbp34rFekPCm");

#[program]
pub mod escrow {
    use super::*;

    const ESCROW_PDA_SEED: &[u8] = b"escrow";

    /// Deposit the funds by:
    /// - populate escrow account state
    /// - set vault_token_account authority to PDA
    /// - transfer funds from giver_token_account to vault_token_account
    pub fn deposit(ctx: Context<Deposit>, /* _vault_account_bump: u8, */ amount: u64) -> ProgramResult {
        let Deposit { giver, taker, giver_token_account, vault_token_account, token_program, escrow_account, .. } = ctx.accounts;
        let (vault_authority_key, _vault_authority_bump) = Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);

        escrow_account.giver_key = *giver.key;
        escrow_account.taker_key = *taker.key;
        escrow_account.giver_token_account = *giver_token_account.to_account_info().key;
        escrow_account.amount = amount;
        escrow_account.is_released = false;

        // switch authority to newly created vault_authority
        token::set_authority(
            CpiContext::new(
                token_program.clone(),
                SetAuthority { account_or_mint: vault_token_account.to_account_info(), current_authority: giver.clone() },
            ),
            AuthorityType::AccountOwner,
            Some(vault_authority_key)
        )?;

        // transfer the token to vault_account
        token::transfer(
            CpiContext::new(
                token_program.clone(),
                Transfer { from: giver_token_account.to_account_info(), to: vault_token_account.to_account_info(), authority: giver.clone() },
            ),
            amount
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
        let Cancel { giver, giver_token_account, vault_token_account, vault_authority, token_program, escrow_account, .. } = ctx.accounts;
        // let (_vault_authority_key, vault_authority_bump) = Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);
        // let authority_seeds = &[&ESCROW_PDA_SEED[..], &[vault_authority_bump]];

        token::transfer(
            CpiContext::new(
                token_program.clone(),
                Transfer {
                    from:      vault_token_account.to_account_info().clone(),
                    to:        giver_token_account.to_account_info().clone(),
                    authority: vault_authority.clone(),
                }
            ), // .with_signer(&[&authority_seeds[..]]),  -- needed?
            escrow_account.amount
        )?;
        token::close_account(
            CpiContext::new(
                token_program.clone(),
                CloseAccount {
                    account:     vault_token_account.to_account_info().clone(),
                    destination: giver.clone(),
                    authority:   vault_authority.clone(),
                }
            ), // .with_signer(&[&authority_seeds[..]]),  -- needed?
        )?;

        Ok(())
    }

    /// Release the funds back to giver via:
    /// - transfer funds to taker
    /// - close the vault_token_account and escrow_account
    pub fn withdraw(ctx: Context<Withdraw>) -> ProgramResult {
        let Withdraw { giver, taker_token_account, vault_token_account, vault_authority, token_program, escrow_account, .. } = ctx.accounts;
        // let (_vault_authority_key, vault_authority_bump) = Pubkey::find_program_address(&[ESCROW_PDA_SEED], ctx.program_id);
        // let authority_seeds = &[&ESCROW_PDA_SEED[..], &[vault_authority_bump]];

        token::transfer(
            CpiContext::new(
                token_program.clone(),
                Transfer {
                    from:      vault_token_account.to_account_info().clone(),
                    to:        taker_token_account.to_account_info().clone(),
                    authority: vault_authority.clone(),
                }
            ), // .with_signer(&[&authority_seeds[..]]),  -- needed?
            escrow_account.amount
        )?;
        token::close_account(
            CpiContext::new(
                token_program.clone(),
                CloseAccount {
                    account:     vault_token_account.to_account_info().clone(),
                    destination: giver.clone(),
                    authority:   vault_authority.clone(),
                }
            ), // .with_signer(&[&authority_seeds[..]]),  -- needed?
        )?;

        Ok(())
    }
}

#[account]
#[derive(Default)]
pub struct EscrowAccount {
    pub giver_key: Pubkey,
    pub taker_key: Pubkey,
    pub giver_token_account: Pubkey,
    pub amount: u64,
    pub is_released: bool,
}

#[derive(Accounts)]
//#[instruction(vault_account_bump: u8, initializer_amount: u64)]
#[instruction(amount: u64)]
pub struct Deposit<'info> {
    #[account(mut, signer)]
    pub giver: AccountInfo<'info>,
    pub taker: AccountInfo<'info>,
    pub mint: Account<'info, Mint>,
    #[account(mut, constraint = giver_token_account.mint == mint.key() && giver_token_account.amount >= amount)]
    pub giver_token_account: Account<'info, TokenAccount>,
    #[account(constraint = taker_token_account.mint == mint.key())]
    pub taker_token_account: Account<'info, TokenAccount>,
    #[account(init, payer = giver, token::mint = mint, token::authority = giver)]  // can assign to vault_account straight away? also, seen following elsewhere... seeds = [b"token-seed".as_ref()], bump = vault_account_bump,
    pub vault_token_account: Account<'info, TokenAccount>,   // can be created internally?
    #[account(init, payer = giver)]
    pub escrow_account: Account<'info, EscrowAccount>,
    pub system_program: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,           // needed in accounts?
    pub token_program: AccountInfo<'info>,   // for validation purposes?
}

#[derive(Accounts)]
pub struct Release<'info> {
    pub giver: AccountInfo<'info>,
    #[account(mut, constraint = escrow_account.giver_key == giver.key())]
    pub escrow_account: Account<'info, EscrowAccount>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(mut, signer)]
    pub giver: AccountInfo<'info>,
    #[account(mut)]
    pub giver_token_account: Account<'info, TokenAccount>,
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = escrow_account.giver_key == *giver.key && escrow_account.giver_token_account == *giver_token_account.to_account_info().key,
        close = giver
    )]
    pub escrow_account: Account<'info, EscrowAccount>,
    #[account(mut)]  // cannot add `close = giver` due to usage of AccountInfo instead of Account?
    pub vault_authority: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub giver: AccountInfo<'info>,
    #[account(mut, signer)]
    pub taker: AccountInfo<'info>,
    #[account(mut)]
    pub taker_token_account: Account<'info, TokenAccount>,
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = escrow_account.is_released && escrow_account.taker_key == *taker.key && escrow_account.giver_key == *giver.key,
        close = giver
    )]
    pub escrow_account: Account<'info, EscrowAccount>,
    #[account(mut)]  // cannot add `close = giver` due to usage of AccountInfo instead of Account?
    pub vault_authority: AccountInfo<'info>,
    pub token_program: AccountInfo<'info>,
}
