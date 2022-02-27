define USAGE
Usage:
    1-off setup: make clean setup
    add account pubkey to lib.rs's declare_id!(), and Anchor.toml's programs.devnet
    repeat as needed: make build deploy test
endef
export USAGE

.EXPORT_ALL_VARIABLES:

ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
ANCHOR_WALLET=target/id.json

all: usage

usage:
	@echo "$$USAGE"

setup:
	npm install
	cargo install --git https://github.com/project-serum/anchor --tag v0.20.1 anchor-cli --locked  # needed for M1 chip
	solana-keygen new -o ${ANCHOR_WALLET} --force
	@echo "Kegen wallet"
	@make keygen-wallet keygen-account airdrop
	@echo
	@echo "Account pubkey, add to lib.rs's declare_id!(), and Anchor.toml's programs.devnet"
	@make account-pubkey

airdrop:
	@for number in 1 2 3 ; do \
		solana airdrop 2 $(shell solana-keygen pubkey target/id.json) --url https://api.devnet.solana.com ; \
    done

keygen-wallet:
	@solana-keygen pubkey ${ANCHOR_WALLET} --force

keygen-account:
	@solana-keygen new -o ./target/deploy/escrow-keypair.json

account-pubkey:
	@solana address -k ./target/deploy/escrow-keypair.json

build:
	anchor build

deploy:
	anchor deploy --provider.cluster devnet --provider.wallet ${ANCHOR_WALLET}

clean:
	rm -rf target node_modules

test:
	anchor test

exec-deposit:
	node client.js --command execute --amount 5 --program $(shell solana address -k target/deploy/escrow-keypair.json)

exec-cancel:
	node client.js --command cancel --program $(shell solana address -k target/deploy/escrow-keypair.json)

exec-release:
	node client.js --command reelase --program $(shell solana address -k target/deploy/escrow-keypair.json)

exec-withdraw:
	node client.js --command withdraw --program $(shell solana address -k target/deploy/escrow-keypair.json)