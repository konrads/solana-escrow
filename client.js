// Parse arguments
// --program - [Required] The account address for your deployed program.
// --feed - The account address for the Chainlink data feed to retrieve
const args = require('minimist')(process.argv.slice(2));

// Initialize Anchor and provider
const anchor = require("@project-serum/anchor");
const provider = anchor.Provider.env();
// Configure the cluster.
anchor.setProvider(provider);

const CHAINLINK_PROGRAM_ID = "CaH12fwNTKJAG8PxEvo9R96Zc2j8qNHZaFj8ZW49yZNT";
const DIVISOR = 100000000;

// Data feed account address
// Default is SOL / USD
const default_feed = "EdWr4ww1Dq82vPe8GFjjcVPo2Qno3Nhn6baCgM3dCy28";
const CHAINLINK_FEED = args['feed'] || default_feed;

async function main() {
  // Read the generated IDL.
  const idl = JSON.parse(
    require("fs").readFileSync("./target/idl/escrow.json", "utf8")
  );

  const command = args['command'];
  console.assert(['execute', 'execute-cached'].includes(command), 'Invalid command');

  // Address of the deployed program.
  const programId = new anchor.web3.PublicKey(args['program']);

  // Generate the program client from IDL.
  const program = new anchor.Program(idl, programId);

  // Execute the RPC.
  var tx;
  var priceFeedAccount;
  if (command == 'execute') {
    priceFeedAccount = anchor.web3.Keypair.generate();
    console.log('priceFeedAccount public key: ' + priceFeedAccount.publicKey);
    console.log('priceFeedAccount secret key: ' + priceFeedAccount.secretKey);
    console.log('user public key: ' + provider.wallet.publicKey);
  
    tx = await program.rpc.execute({
      accounts: {
        decimal:          priceFeedAccount.publicKey,
        user:             provider.wallet.publicKey,
        chainlinkFeed:    CHAINLINK_FEED,
        chainlinkProgram: CHAINLINK_PROGRAM_ID,
        systemProgram:    anchor.web3.SystemProgram.programId
      },
      options: { commitment: "confirmed" },
      signers: [priceFeedAccount],
    });
  } else if (command == 'execute-cached') {
    priceFeedAccount = anchor.web3.Keypair.fromSecretKey(new Uint8Array(
      [246,93,29,13,85,218,228,14,196,89,53,211,233,69,34,214,210,172,198,165,118,214,194,78,74,210,39,91,95,169,208,146,164,119,13,231,200,97,251,181,146,251,220,153,55,24,105,252,172,4,39,18,207,28,252,211,33,152,220,223,37,52,215,113]
    ));
    console.log('priceFeedAccount public key: ' + priceFeedAccount.publicKey);
    console.log('priceFeedAccount secret key: ' + priceFeedAccount.secretKey);
    console.log('user public key: ' + provider.wallet.publicKey);
  
    tx = await program.rpc.executeCached({
      accounts: {
        decimal:          priceFeedAccount.publicKey,
        user:             provider.wallet.publicKey,
        chainlinkFeed:    CHAINLINK_FEED,
        chainlinkProgram: CHAINLINK_PROGRAM_ID,
        systemProgram:    anchor.web3.SystemProgram.programId
      },
      options: { commitment: "confirmed" },
      signers: [priceFeedAccount],
    });
  }
  // let tx = await program.rpc.execute({
  //   accounts: {
  //     decimal: priceFeedAccount.publicKey,
  //     user: provider.wallet.publicKey,
  //     chainlinkFeed: CHAINLINK_FEED,
  //     chainlinkProgram: CHAINLINK_PROGRAM_ID,
  //     systemProgram: anchor.web3.SystemProgram.programId
  //   },
  //   options: { commitment: "confirmed" },
  //   signers: [priceFeedAccount],
  // });
  // let tx = await program.rpc.execute({
  //   accounts: {
  //     decimal:          priceFeedAccountPK,
  //     chainlinkFeed:    CHAINLINK_FEED,
  //     chainlinkProgram: CHAINLINK_PROGRAM_ID,
  //     systemProgram:    anchor.web3.SystemProgram.programId
  //   },
  //   options: { commitment: "confirmed" },
  //   signers: [priceFeedAccount],   // KS: what is that, vs user?
  // });

  console.log("Fetching transaction logs...");
  let t = await provider.connection.getConfirmedTransaction(tx, "confirmed");
  console.log(t.meta.logMessages);
  // #endregion main

  // Fetch the account details of the account containing the price data
  const latestPrice = await program.account.decimal.fetch(priceFeedAccount.publicKey);
  console.log('Price Is: ' + latestPrice.value / DIVISOR)
}

console.log("Running client...");
main().then(() => console.log("Success"));
