import React from 'react';
import { Web3OnboardProvider, init } from '@web3-onboard/react';
import injectedModule from '@web3-onboard/injected-wallets';

const injected = injectedModule();

const web3Onboard = init({
  wallets: [injected],
  chains: [
    {
      id: '0x1', // Ethereum Mainnet
      token: 'ETH',
      label: 'Ethereum Mainnet',
      rpcUrl: 'https://mainnet.infura.io/v3/YOUR_INFURA_KEY',
    },
    {
      id: '0xaa36a7', // Sepolia Testnet
      token: 'SepoliaETH',
      label: 'Sepolia Testnet',
      rpcUrl: 'https://sepolia.infura.io/v3/YOUR_INFURA_KEY',
    },
    {
      id: '0x539', // Local network (31337 in hex)
      token: 'ETH',
      label: 'Localhost 8545',
      rpcUrl: 'http://localhost:8545',
    },
  ],
  appMetadata: {
    name: 'ZWToken',
    icon: '<svg><!-- Your icon SVG --></svg>',
    description: 'ZWToken - Browser-friendly Zero-Knowledge Proof Privacy Token',
    recommendedInjectedWallets: [
      { name: 'MetaMask', url: 'https://metamask.io' },
      { name: 'Coinbase', url: 'https://www.coinbase.com/wallet' },
    ],
  },
  accountCenter: {
    desktop: {
      enabled: false,
    },
    mobile: {
      enabled: false,
    },
  },
});

interface Web3ProviderProps {
  children: React.ReactNode;
}

const Web3Provider: React.FC<Web3ProviderProps> = ({ children }) => {
  return <Web3OnboardProvider web3Onboard={web3Onboard}>{children}</Web3OnboardProvider>;
};

export default Web3Provider;
