# Escrow smart contract

Solana escrow program, to be utilized by the `Giver` and `Taker` actors. `Giver` supplies the funds, `Taker` receives them upon their release. Note: funds are deposited and withdrawn in the same currency.

Following actions are allowed:
- `deposit` of funds by the `Giver`, moving the funds into the escrow account
- `release` of the funds by the `Giver`, making them available by the `Taker`
- `withdraw` of the released funds by the `Taker`
- `cancel` of the unreleased funds, performed by the `Giver`

## Scenarios

### Typical scenario

`Giver` deposits and releases the funds, `Taker` withdraws.

```
     Giver           Taker           Escrow
       |               |               |
       |   deposit     |               |
       |------------------------------>|  ok
       |               |               |
       |   release     |               |
       |------------------------------>|  ok
       |               |               |
       |               |   withdraw    |
       |               |-------------->|  ok, transfer to taker
       |               |               |
```

### Cancelled withdraw attempt

`Giver` deposits, then cancels, `Taker` fails on withdraw.

```
     Giver           Taker           Escrow
       |               |               |
       |   deposit     |               |
       |------------------------------>| ok
       |               |               |
       |   cancel      |               |
       |------------------------------>| ok
       |               |               |
       |               |   withdraw    |
       |               |-------------->| err
       |               |               |
       |   release     |               |
       |------------------------------>| err
       |               |               |
```

`Giver` deposits, then releases, cancels, `Taker` fails on withdraw.

```
     Giver           Taker           Escrow
       |               |               |
       |   deposit     |               |
       |------------------------------>| ok
       |               |               |
       |   release     |               |
       |------------------------------>| ok
       |               |               |
       |   cancel      |               |
       |------------------------------>| ok
       |               |               |
       |               |   withdraw    |
       |               |-------------->| err
       |               |               |
```

## Integration testing
Test via typescript interface
```
anchor test
```

## Development process on testnet
Following is a (work in progress... :frowning_face:) attempt of running tests on testnet.

1-off setup
```
make clean setup
```

Add account pubkey to lib.rs's declare_id!(), and Anchor.toml's programs.devnet/programs.testnet

Repeat as needed
```
make build deploy test
```

## Requirements
- [NodeJS 12](https://nodejs.org/en/download/) or higher
- [Rust](https://www.rust-lang.org/tools/install)
- [Solana CLI](https://github.com/solana-labs/solana/releases)
- A C compiler such as the one included in [GCC](https://gcc.gnu.org/install/).

## References
- https://github.com/smartcontractkit/solana-starter-kit
- https://hackmd.io/@ironaddicteddog/anchor_example_escrow
