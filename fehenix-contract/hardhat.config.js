require("@nomicfoundation/hardhat-toolbox");
require("@cofhe/hardhat-plugin");
require("dotenv").config();

function normalizePrivateKey(privateKey) {
  if (!privateKey) {
    return [];
  }

  return [privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`];
}

const networks = {
  "eth-sepolia": {
    url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia.publicnode.com",
    chainId: 11155111,
    accounts: normalizePrivateKey(process.env.PRIVATE_KEY),
    timeout: 60000
  }
};

networks.sepolia = networks["eth-sepolia"];

if (process.env.ARBITRUM_SEPOLIA_RPC_URL) {
  networks["arb-sepolia"] = {
    url: process.env.ARBITRUM_SEPOLIA_RPC_URL,
    chainId: 421614,
    accounts: normalizePrivateKey(process.env.PRIVATE_KEY),
    timeout: 60000
  };
}

if (process.env.BASE_SEPOLIA_RPC_URL) {
  networks["base-sepolia"] = {
    url: process.env.BASE_SEPOLIA_RPC_URL,
    chainId: 84532,
    accounts: normalizePrivateKey(process.env.PRIVATE_KEY),
    timeout: 60000
  };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  cofhe: {
    logMocks: false
  },
  solidity: {
    version: "0.8.25",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      evmVersion: "cancun",
      viaIR: true
    }
  },
  networks
};
