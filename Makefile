define USAGE
Usage:
    1-off setup: make clean setup
    add account pubkey to lib.rs's declare_id!(), and Anchor.toml's programs.devnet/programs.testnet
    repeat as needed: make build deploy test
endef
export USAGE

# USDC devnet: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
# my token testnet: 4AkiDhL4hitLsruoNbwtpwWmo9QbNtQr43s53Y5PiRGZ  (supply 1000)

.NOTPARALLEL:

.EXPORT_ALL_VARIABLES:

SOLANA_NET=testnet
# SOLANA_NET=devnet
ANCHOR_PROVIDER_URL=https://api.${SOLANA_NET}.solana.com
GIVER_WALLET=target/giver.json
TAKER_WALLET=target/taker.json
GIVER_TOKEN_WALLET=target/giver-token.json
TAKER_TOKEN_WALLET=target/taker-token.json
VAULT_TOKEN_WALLET=target/vault-token.json
ESCROW_PROGRAM_WALLET=target/escrow-program.json
ESCROW_STATE_WALLET=target/escrow-state.json
TOKEN_ADDRESS_FILE=target/token.address.txt
TOKEN_ACCOUNT_ADDRESS_FILE=target/token-account.address.txt
GIVER_TOKEN_PK=target/giver-token.pk.txt
TAKER_TOKEN_PK=target/taker-token.pk.txt
ESCROW_STATE_PK=target/escrow-state.pk.txt

all: usage

usage:
	@echo "$$USAGE"

setup:
	npm install
	cargo install --git https://github.com/project-serum/anchor --tag v0.20.1 anchor-cli --locked  # needed for M1 chip
	# cargo install spl-token-cli
	@echo "Generate wallets & airdrop"
	@make wallet-gen airdrop token-gen
	@echo
	@echo "Escrow account pubkey, add to lib.rs's declare_id!(), and Anchor.toml's programs.devnet/programs.testnet"
	@make escrow-account-pubkey

airdrop:
	@for number in 1 2 3 4 5m; do \
		solana airdrop 1 $(shell solana-keygen pubkey target/giver.json) --url ${ANCHOR_PROVIDER_URL} ; \
		solana airdrop 1 $(shell solana-keygen pubkey target/taker.json) --url ${ANCHOR_PROVIDER_URL} ; \
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
	anchor deploy --provider.cluster ${SOLANA_NET} --provider.wallet ${GIVER_WALLET}

clean:
	rm -rf target node_modules

test:
	anchor test

exec-deposit:
	ANCHOR_WALLET=${GIVER_WALLET} node client.js --command deposit --amount 5 --program $(shell solana address -k target/deploy/escrow-keypair.json)

exec-cancel:
	ANCHOR_WALLET=${GIVER_WALLET} node client.js --command cancel --program $(shell solana address -k target/deploy/escrow-keypair.json)

exec-release:
	ANCHOR_WALLET=${GIVER_WALLET} node client.js --command release --program $(shell solana address -k target/deploy/escrow-keypair.json)

exec-withdraw:
	ANCHOR_WALLET=${TAKER_WALLET} node client.js --command withdraw --program $(shell solana address -k target/deploy/escrow-keypair.json)

# Seperating into 2 targets as if inside 1 target, 'cat' is evaluated prior to spl-token create-token finishes
_gen-token-output:
	@spl-token create-token | tee token.output.tmp && cat token.output.tmp | head -1 | awk '{ print $$3 }' > ${TOKEN_ADDRESS_FILE}
_gen-giver-token-output:
	@ANCHOR_WALLET=${GIVER_WALLET} spl-token create-account $(shell cat target/token.address.txt) | tee token-giver.output.tmp && cat token-giver.output.tmp | head -1 | awk '{ print $$3 }' > ${GIVER_TOKEN_PK}
_gen-taker-token-output:
	@ANCHOR_WALLET=${TAKER_WALLET} spl-token create-account $(shell cat target/token.address.txt) | tee token-taker.output.tmp && cat token-taker.output.tmp | head -1 | awk '{ print $$3 }' > ${TAKER_TOKEN_PK}
_gen-escrow-token-output:
	@ANCHOR_WALLET=${GIVER_WALLET} spl-token create-account $(shell cat target/token.address.txt) | tee token-escrow.output.tmp && cat token-escrow.output.tmp | head -1 | awk '{ print $$3 }' > ${ESCROW_TOKEN_PK}
token-gen: _gen-token-output _gen-giver-token-output _gen-taker-token-output _gen-escrow-token-output
	$(eval TOKEN_ADDRESS=$(shell cat target/token.address.txt))
	$(eval TOKEN_ADDRESS=$(shell cat target/token.address.txt))
	$(eval TOKEN_ADDRESS=$(shell cat target/token.address.txt))
	$(eval TOKEN_ADDRESS=$(shell cat target/token.address.txt))


	$(eval TOKEN_ADDRESS=$(shell cat token.output.tmp | head -1 | awk '{ print $$3 }'))
	@echo Creating & minting giver token account...
	ANCHOR_WALLET=${GIVER_WALLET} spl-token create-account $(TOKEN_ADDRESS) | tee token-giver.output.tmp
	@echo Creating taker token account...
	ANCHOR_WALLET=${TAKER_WALLET} spl-token create-account $(TOKEN_ADDRESS) | tee token-taker.output.tmp
	@echo Creating escrow token account...
	ANCHOR_WALLET=${GIVER_WALLET} spl-token create-account $(TOKEN_ADDRESS) | tee token-escrow.output.tmp
	@echo Minting to giver account
	@spl-token mint $(TOKEN_ADDRESS) 1000
	$(eval GIVER_TOKEN_ADDRESS=$(shell cat token-giver.output.tmp | head -1 | awk '{ print $$3 }'))
	$(eval TAKER_TOKEN_ADDRESS=$(shell cat token-taker.output.tmp | head -1 | awk '{ print $$3 }'))
	$(eval ESCROW_TOKEN_ADDRESS=$(shell cat token-escrow.output.tmp | head -1 | awk '{ print $$3 }'))
	@echo $(TOKEN_ADDRESS) > ${TOKEN_ADDRESS_FILE}
	@echo $(GIVER_TOKEN_ADDRESS) > ${GIVER_TOKEN_WALLET}
	@echo $(TAKER_TOKEN_ADDRESS) > ${TAKER_TOKEN_WALLET}
	@echo $(ESCROW_TOKEN_ADDRESS) > ${ESCROW_TOKEN_WALLET}
	@echo Created and funded token $(TOKEN_ADDRESS) in ${TOKEN_ADDRESS_FILE}
	@rm *.tmp

# Creates token and its account, this time mints token to the acocunt
#
# as per https://medium.com/@kaloliya/step-by-step-guide-for-creating-a-token-on-solana-network-68d3b890ca84
# note: spl-token mint gives error:
#    RPC response error -32002: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x3 [5 log messages]
#    I believe this is due to MintMismatch error: https://github.com/solana-labs/solana-program-library/blob/ea354ab358021aa08f774e2d4028b33ec56d4180/token/program/src/error.rs#L22
token-gen2: _gen-token-output
	$(eval TOKEN_ADDRESS=$(shell cat token.output.tmp | head -1 | awk '{ print $$3 }'))
	spl-token create-account $(TOKEN_ADDRESS) | tee token-address.output.tmp
	$(eval TOKEN_ACCOUNT_ADDRESS=$(shell cat token-address.output.tmp | head -1 | awk '{ print $$3 }'))
	echo $(TOKEN_ACCOUNT_ADDRESS) > ${TOKEN_ACCOUNT_ADDRESS_FILE}
	echo Created and funded token account $(TOKEN_ACCOUNT_ADDRESS) in ${TOKEN_ACCOUNT_ADDRESS_FILE}
	spl-token mint $(TOKEN_ADDRESS) 1000 $(TOKEN_ACCOUNT_ADDRESS)
	echo $(TOKEN_ADDRESS) > ${TOKEN_ADDRESS_FILE}
	echo $(TOKEN_ACCOUNT_ADDRESS) > ${TOKEN_ACCOUNT_ADDRESS_FILE}
	echo Created and funded token $(TOKEN_ADDRESS) in ${TOKEN_ADDRESS_FILE}, $(TOKEN_ACCOUNT_ADDRESS) in ${TOKEN_ACCOUNT_ADDRESS_FILE}
	# @rm token.output.tmp

show-token-accounts:
	spl-token accounts