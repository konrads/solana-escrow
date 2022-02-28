define USAGE
Usage:
    1-off setup: make clean setup
    add account pubkey to lib.rs's declare_id!(), and Anchor.toml's programs.devnet
    repeat as needed: make build deploy test
endef
export USAGE

.EXPORT_ALL_VARIABLES:

ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
GIVER_WALLET=target/giver.json
TAKER_WALLET=target/taker.json
GIVER_TOKEN_WALLET=target/giver-token.json
TAKER_TOKEN_WALLET=target/taker-token.json
VAULT_TOKEN_WALLET=target/vault-token.json
ESCROW_PROGRAM_WALLET=target/escrow-program.json
ESCROW_STATE_WALLET=target/escrow-state.json
TOKEN_ADDRESS=target/token.address.txt

all: usage

usage:
	@echo "$$USAGE"

setup:
	npm install
	cargo install --git https://github.com/project-serum/anchor --tag v0.20.1 anchor-cli --locked  # needed for M1 chip
	# cargo install spl-token-cli
	@echo "Generate wallets & airdrop"
	@make wallet-gen airdrop
	@echo
	@echo "Escrow account pubkey, add to lib.rs's declare_id!(), and Anchor.toml's programs.devnet"
	@make escrow-account-pubkey

airdrop:
	@for number in 1 2 3 ; do \
		solana airdrop 2 $(shell solana-keygen pubkey target/giver.json) --url https://api.devnet.solana.com ; \
		solana airdrop 2 $(shell solana-keygen pubkey target/taker.json) --url https://api.devnet.solana.com ; \
    done

wallet-gen:
	@solana-keygen new -o ${GIVER_WALLET} --force
	@solana-keygen new -o ${TAKER_WALLET} --force
	@solana-keygen new -o ${GIVER_TOKEN_WALLET} --force
	@solana-keygen new -o ${TAKER_TOKEN_WALLET} --force
	@solana-keygen new -o ${VAULT_TOKEN_WALLET} --force
	@solana-keygen new -o ${ESCROW_PROGRAM_WALLET} --force
	@solana-keygen new -o ${ESCROW_STATE_WALLET} --force

escrow-account-pubkey:
	@solana address -k ${ESCROW_PROGRAM_WALLET}

build:
	anchor build

deploy:
	anchor deploy --provider.cluster devnet --provider.wallet ${GIVER_WALLET}

clean:
	rm -rf target node_modules

test:
	anchor test

exec-deposit:
	node client.js --command execute --amount 5 --program $(shell solana address -k target/deploy/escrow-keypair.json)

exec-cancel:
	node client.js --command cancel --program $(shell solana address -k target/deploy/escrow-keypair.json)

exec-release:
	node client.js --command reelase --program $(shell solana address -k l/escrow-keypair.json)

exec-withdraw:
	node client.js --command withdraw --program $(shell solana address -k target/deploy/escrow-keypair.json)

# Seperating into 2 targets as if inside 1 target, 'cat' is evaluated prior to spl-token create-token finishes
_gen-token-output:
	@spl-token create-token > token.output.tmp
create-token: _gen-token-output
	$(eval token=$(shell cat token.output.tmp | head -1 | awk '{ print $$3 }'))
	@spl-token create-account $(token)
	@spl-token mint $(token) 1000
	@echo $(token) > ${TOKEN_ADDRESS}
	@echo Created and funded token $(token) in ${TOKEN_ADDRESS}
	@rm token.output.tmp
