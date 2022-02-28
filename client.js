const args = require('minimist')(process.argv.slice(2));
const anchor = require("@project-serum/anchor");
const provider = anchor.Provider.env();
anchor.setProvider(provider);

function readKeypair(location) {
  const keypair = JSON.parse(require("fs").readFileSync(location))
  const arr = Object.values(keypair._keypair.secretKey)
  const secret = new Uint8Array(arr)
  return web3.Keypair.fromSecretKey(secret)
}

async function main() {
  // Read the generated IDL.
  const idl = JSON.parse(require("fs").readFileSync("./target/idl/escrow.json", "utf8"));

  const command = args['command'];
  const amount = args['amount'];
  console.assert(['deposit', 'release', 'cancel', 'withdraw'].includes(command), `Invalid command: ${command}`);
  
  // Address of the deployed program.
  const programId = new anchor.web3.PublicKey(args['program']);

  // Generate the program client from IDL.
  const program = new anchor.Program(idl, programId);

  const escrowProgramKP = readKeypair('./target/escrow-program.json')
  const escrowStateKP = readKeypair('./target/escrow-state.json')
  const giverKP = readKeypair('./target/giver.json')
  const takerKP = readKeypair('./target/taker.json')
  const giverTokenKP = readKeypair('./target/giver-token.json')
  const takerTokenKP = readKeypair('./target/taker-token.json')
  const vaultTokenKP = readKeypair('./target/vault-token.json')
  const mintAddress = require("fs").readFileSync("./target/token.address.txt", "utf8")

  var tx;
  if (command == 'deposit') {
    tx = await program.rpc.deposit(
      amount,
      {
        accounts: {
          giver:               giverKP.publicKey,
          taker:               takerKP.publicKey,
          mint:                mintAddress,
          giver_token_account: giverTokenKP.publicKey,
          taker_token_account: takerTokenKP.publicKey,
          vault_token_account: vaultTokenKP.publicKey,
          escrow_account:      escrowStateKP.publicKey,
          rent:                anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram:       anchor.web3.SystemProgram.programId
        },
        options: { commitment: "confirmed" },
        signers: [giverKP, takerKP, mintKP, giverTokenKP, takerTokenKP, vaultTokenKP, escrowStateKP],
      }
    );
  } else {
    throw `Invalid command: ${command}`
  }

  console.log("Fetching transaction logs...");
  let t = await provider.connection.getConfirmedTransaction(tx, "confirmed");
  console.log(t.meta.logMessages);

  // Fetch the account details of the account containing the price data
  const latestEscrowState = await program.account.escrow_account.fetch(escrow_account.publicKey);
  console.log(`Latest escrow state: ${latestEscrowState}`)
}

console.log("Running client...");
main().then(() => console.log("Success"));
