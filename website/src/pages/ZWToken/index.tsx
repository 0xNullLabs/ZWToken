import {
  Card,
  Tabs,
  Form,
  InputNumber,
  Input,
  Button,
  message,
  Modal,
  Table,
  Checkbox,
  Tooltip,
} from 'antd';
import { CopyOutlined, CloseOutlined, InfoCircleOutlined } from '@ant-design/icons';
import { PageContainer } from '@ant-design/pro-components';
import { useConnectWallet } from '@web3-onboard/react';
import { useIntl } from '@umijs/max';
import { ethers } from 'ethers';
import React, { useState } from 'react';
import { buildPoseidon } from 'circomlibjs';
import { CONTRACT_ADDRESSES, CONTRACT_ABIS } from '@/config/contracts';
import {
  deriveFromSecret,
  rebuildMerkleTree,
  findUserCommitment,
  prepareCircuitInput,
  getCommitLeavesInBatches,
} from '@/utils/zkProof';
// @ts-ignore
import * as snarkjs from 'snarkjs';

const { TabPane } = Tabs;

// Sepolia testnet chainId
const SEPOLIA_CHAIN_ID = 11155111;

// LocalStorage keys for Last Burn information
const LAST_BURN_STORAGE_KEY = 'zwtoken_last_burn_info';

const ZWToken: React.FC = () => {
  const intl = useIntl();
  const [{ wallet }, connect] = useConnectWallet();
  const [simpleDepositForm] = Form.useForm(); // Simple Mode Burn form
  const [advancedDepositForm] = Form.useForm(); // Advanced Mode Wrap form
  const [withdrawForm] = Form.useForm();
  const [transferForm] = Form.useForm();
  const [remintForm] = Form.useForm();
  const [secretForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [secretModalVisible, setSecretModalVisible] = useState(false);
  const [tokenDecimals, setTokenDecimals] = useState<number>(18); // Default 18 digits, will be queried dynamically
  const [usdcBalance, setUsdcBalance] = useState<string>('0');
  const [zwusdcBalance, setZwusdcBalance] = useState<string>('0');
  const [allowance, setAllowance] = useState<string>('0');
  const [simpleDepositAmount, setSimpleDepositAmount] = useState<number | null>(null); // Simple Mode
  const [advancedDepositAmount, setAdvancedDepositAmount] = useState<number | null>(null); // Advanced Mode
  const [isMobile, setIsMobile] = useState(false);
  const [seed, setSeed] = useState<string>('');
  const [secretList, setSecretList] = useState<
    Array<{ index: number; secret: string; address: string; amount: string; loading: boolean; isClaimed: boolean }>
  >([]);
  const [remintSeedModalVisible, setRemintSeedModalVisible] = useState(false);
  const [remintSecretList, setRemintSecretList] = useState<
    Array<{ index: number; secret: string; address: string; amount: string; loading: boolean; isClaimed: boolean }>
  >([]);

  // Advanced Mode Remint states
  const [advancedRemintSeedModalVisible, setAdvancedRemintSeedModalVisible] = useState(false);
  const [advancedRemintSecretList, setAdvancedRemintSecretList] = useState<
    Array<{ index: number; secret: string; address: string; amount: string; loading: boolean; isClaimed: boolean }>
  >([]);

  // Store selected max amount for remint
  const [selectedRemintMaxAmount, setSelectedRemintMaxAmount] = useState<string | null>(null);

  // Transaction hash states for displaying submitted transactions
  const [simpleBurnTxHash, setSimpleBurnTxHash] = useState<string | null>(null);
  const [simpleRemintTxHash, setSimpleRemintTxHash] = useState<string | null>(null);
  const [advancedDepositTxHash, setAdvancedDepositTxHash] = useState<string | null>(null);
  const [advancedWithdrawTxHash, setAdvancedWithdrawTxHash] = useState<string | null>(null);
  const [advancedTransferTxHash, setAdvancedTransferTxHash] = useState<string | null>(null);
  const [advancedRemintTxHash, setAdvancedRemintTxHash] = useState<string | null>(null);

  // Deposit Directly Burn related states
  const [directBurn, setDirectBurn] = useState(false);

  // Last Burn information cache - Initialize from localStorage
  const getLastBurnInfoFromStorage = () => {
    try {
      const stored = localStorage.getItem(LAST_BURN_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to read last burn info from localStorage:', error);
    }
    return { amount: null, address: null, txHash: null, mode: null };
  };

  const lastBurnInfo = getLastBurnInfoFromStorage();
  const [lastBurnAmount, setLastBurnAmount] = useState<string | null>(lastBurnInfo.amount);
  const [lastBurnAddress, setLastBurnAddress] = useState<string | null>(lastBurnInfo.address);
  const [lastBurnTxHash, setLastBurnTxHash] = useState<string | null>(lastBurnInfo.txHash);
  const [lastBurnMode, setLastBurnMode] = useState<'simple' | 'advanced' | null>(lastBurnInfo.mode);

  // Simple Mode Deposit (Burn) states
  const [depositSecretModalVisible, setDepositSecretModalVisible] = useState(false);
  const [depositSecretForm] = Form.useForm();
  const [depositSecretList, setDepositSecretList] = useState<
    Array<{ index: number; secret: string; address: string; amount: string; loading: boolean; isClaimed: boolean }>
  >([]);

  // Advanced Mode Deposit states
  const [advancedDepositSecretModalVisible, setAdvancedDepositSecretModalVisible] = useState(false);
  const [advancedDepositSecretForm] = Form.useForm();
  const [advancedDepositSecretList, setAdvancedDepositSecretList] = useState<
    Array<{ index: number; secret: string; address: string; amount: string; loading: boolean; isClaimed: boolean }>
  >([]);
  const [advancedDepositSecretMode, setAdvancedDepositSecretMode] = useState<
    'manual' | 'seed' | undefined
  >(undefined);

  // Transfer states
  const [transferSecretMode, setTransferSecretMode] = useState<'manual' | 'seed' | undefined>(
    undefined,
  );
  // Save the burn address generated for transfer, to detect if it's a burn transfer
  const [transferBurnAddress, setTransferBurnAddress] = useState<string | null>(null);

  // Get current account
  const account = wallet?.accounts?.[0]?.address;

  // Track current active tab (simple or advanced)
  const [activeMainTab, setActiveMainTab] = useState<string>('simple');
  const [activeSimpleTab, setActiveSimpleTab] = useState<string>('burn');
  const [activeAdvancedTab, setActiveAdvancedTab] = useState<string>('deposit');

  // Helper functions to manage Last Burn info in localStorage
  const saveLastBurnToStorage = (amount: string, address: string, txHash: string, mode: 'simple' | 'advanced') => {
    try {
      const burnInfo = {
        amount,
        address,
        txHash,
        mode,
      };
      localStorage.setItem(LAST_BURN_STORAGE_KEY, JSON.stringify(burnInfo));
    } catch (error) {
      console.error('Failed to save last burn info to localStorage:', error);
    }
  };

  const clearLastBurnInfo = () => {
    try {
      localStorage.removeItem(LAST_BURN_STORAGE_KEY);
      setLastBurnAmount(null);
      setLastBurnAddress(null);
      setLastBurnTxHash(null);
      setLastBurnMode(null);
      message.success('Last burn information cleared');
    } catch (error) {
      console.error('Failed to clear last burn info:', error);
      message.error('Failed to clear information');
    }
  };

  // Listen to window size changes
  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 576);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Function to get token decimals
  const fetchDecimals = React.useCallback(async () => {
    if (!wallet) return;

    try {
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();

      if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
        console.log('Network is not Sepolia, skipping decimals fetch');
        return;
      }

      const underlyingContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingToken,
        ['function decimals() view returns (uint8)'],
        provider,
      );
      const decimals = await underlyingContract.decimals();
      setTokenDecimals(Number(decimals));
      console.log('Token decimals:', decimals);
    } catch (error) {
      console.error('Failed to fetch token decimals:', error);
      // Keep default value 18
    }
  }, [wallet]);

  // Function to refresh balances - Scan ERC721 NFTs
  const refreshBalances = React.useCallback(async () => {
    if (!wallet || !account) {
      setUsdcBalance('0');
      setZwusdcBalance('0');
      setAllowance('0');
      return;
    }

    try {
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();

      if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
        console.log('Network is not Sepolia, skipping balance refresh');
        setUsdcBalance('0');
        setZwusdcBalance('0');
        setAllowance('0');
        return;
      }

      // Query NFT balance by scanning ownerOf for each tokenId
      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingNFT,
        CONTRACT_ABIS.ERC721,
        provider,
      );
      
      // Get current token counter
      const currentTokenId = await nftContract.getCurrentTokenId();
      console.log(`Scanning NFTs from tokenId 0 to ${currentTokenId - 1}`);
      
      // Count NFTs owned by user
      let userNFTCount = 0;
      for (let tokenId = 0; tokenId < currentTokenId; tokenId++) {
        try {
          const owner = await nftContract.ownerOf(tokenId);
          if (owner.toLowerCase() === account.toLowerCase()) {
            userNFTCount++;
          }
        } catch (error) {
          // Token might be burned or not exist, skip
          console.log(`Token ${tokenId} does not exist or is burned`);
        }
      }
      
      setUsdcBalance(userNFTCount.toString());
      console.log(`User owns ${userNFTCount} NFTs`);

      // Query if user has approved all NFTs to ZWERC721
      const isApprovedForAll = await nftContract.isApprovedForAll(account, CONTRACT_ADDRESSES.ZWERC721);
      setAllowance(isApprovedForAll ? '999999' : '0');

      // Query ZWNFT balance by scanning ZWERC721
      const zwnftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        provider,
      );
      
      // Get current token counter from underlying NFT (ZWERC721 tracks same tokenIds)
      let userZWNFTCount = 0;
      for (let tokenId = 0; tokenId < currentTokenId; tokenId++) {
        try {
          const owner = await zwnftContract.ownerOf(tokenId);
          if (owner.toLowerCase() === account.toLowerCase()) {
            userZWNFTCount++;
          }
        } catch (error) {
          // Token might not exist in ZWERC721, skip
        }
      }
      
      setZwusdcBalance(userZWNFTCount.toString());
      console.log(`User owns ${userZWNFTCount} ZWNFTs`);
    } catch (error) {
      console.error('Failed to fetch balances:', error);
    }
  }, [wallet, account, tokenDecimals]);

  // Check and switch to Sepolia network
  React.useEffect(() => {
    const checkNetwork = async () => {
      if (!wallet) return;

      try {
        // Don't pass chainId, get the actually connected network
        const provider = new ethers.BrowserProvider(wallet.provider);
        const network = await provider.getNetwork();

        console.log('Currently connected network chainId:', Number(network.chainId));

        if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
          message.error(
            `Error: Currently connected to Chain ID ${Number(
              network.chainId,
            )} network, please switch to Sepolia testnet (Chain ID: 11155111)`,
            10,
          );

          // Try to switch network
          try {
            await wallet.provider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}` }],
            });
            message.success('Successfully switched to Sepolia testnet');
          } catch (switchError: any) {
            console.error('Failed to switch network:', switchError);
            // If network doesn't exist, try to add network
            if (switchError.code === 4902) {
              try {
                await wallet.provider.request({
                  method: 'wallet_addEthereumChain',
                  params: [
                    {
                      chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}`,
                      chainName: 'Sepolia Test Network',
                      nativeCurrency: {
                        name: 'Sepolia ETH',
                        symbol: 'SEP',
                        decimals: 18,
                      },
                      rpcUrls: ['https://sepolia.infura.io/v3/'],
                      blockExplorerUrls: ['https://sepolia.etherscan.io'],
                    },
                  ],
                });
                message.success('Added and switched to Sepolia testnet');
              } catch (addError) {
                console.error('Failed to add network:', addError);
                message.error('Unable to add Sepolia network, please add it manually in wallet');
              }
            } else {
              message.error('Network switch failed, please manually switch to Sepolia testnet');
            }
          }
        } else {
          console.log('✅ Connected to Sepolia testnet');
        }
      } catch (error) {
        console.error('Failed to check network:', error);
      }
    };

    checkNetwork();

    // Listen to network change events
    if (wallet?.provider) {
      const handleChainChanged = (chainId: string) => {
        const decimalChainId = parseInt(chainId, 16);
        console.log('Network switched to chainId:', decimalChainId);

        if (decimalChainId !== SEPOLIA_CHAIN_ID) {
          message.warning(
            `Network has switched to Chain ID ${decimalChainId}, please switch back to Sepolia testnet (Chain ID: 11155111)`,
          );
          // Clear balance display
          setUsdcBalance('0');
          setZwusdcBalance('0');
        } else {
          message.success('✅ Connected to Sepolia testnet, refreshing data...');
          // Refresh data instead of refreshing page
          setTimeout(() => {
            fetchDecimals();
            refreshBalances();
          }, 500);
        }
      };

      wallet.provider.on('chainChanged', handleChainChanged);

      // Cleanup function
      return () => {
        if (wallet?.provider?.removeListener) {
          wallet.provider.removeListener('chainChanged', handleChainChanged);
        }
      };
    }
  }, [wallet, refreshBalances, fetchDecimals]);

  // Initially get token decimals
  React.useEffect(() => {
    fetchDecimals();
  }, [fetchDecimals]);

  // Get balances
  React.useEffect(() => {
    refreshBalances();

    // Refresh balances every 10 seconds
    const interval = setInterval(refreshBalances, 10000);

    return () => clearInterval(interval);
  }, [refreshBalances]);

  // Delay preloading circuits files to avoid blocking main page elements loading
  React.useEffect(() => {
    const preloadCircuits = () => {
      try {
        console.log('Starting to preload circuits files...');

        // Use prefetch to preload circuits files
        const link1 = document.createElement('link');
        link1.rel = 'prefetch';
        link1.as = 'fetch';
        link1.href = '/circuits/remint.wasm';
        document.head.appendChild(link1);

        const link2 = document.createElement('link');
        link2.rel = 'prefetch';
        link2.as = 'fetch';
        link2.href = '/circuits/remint_final.zkey';
        document.head.appendChild(link2);

        console.log('Circuits files preload links added');
      } catch (error) {
        console.error('Failed to preload circuits:', error);
      }
    };

    // Use requestIdleCallback to load when browser is idle, or delay 3 seconds
    if ('requestIdleCallback' in window) {
      const idleCallbackId = (window as any).requestIdleCallback(
        preloadCircuits,
        { timeout: 3000 }, // Force execution after at most 3 seconds
      );

      return () => {
        if ('cancelIdleCallback' in window) {
          (window as any).cancelIdleCallback(idleCallbackId);
        }
      };
    } else {
      // Fallback: delay 3 seconds then load
      const timeoutId = setTimeout(preloadCircuits, 3000);
      return () => clearTimeout(timeoutId);
    }
  }, []); // Empty dependency array, only execute once when component mounts

  // When wallet address changes, update Simple Mode Remint form's recipient field
  React.useEffect(() => {
    if (account) {
      const currentRecipient = remintForm.getFieldValue('recipient');
      // Only auto-fill when recipient is empty
      if (!currentRecipient) {
        remintForm.setFieldsValue({ recipient: account });
      }
    }
  }, [account, remintForm]);

  // Get provider and signer, and check network
  const getProvider = async () => {
    if (!wallet) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return null;
    }

    const provider = new ethers.BrowserProvider(wallet.provider);
    const network = await provider.getNetwork();

    if (Number(network.chainId) !== SEPOLIA_CHAIN_ID) {
      message.error(
        `Currently connected to Chain ID ${Number(
          network.chainId,
        )} network, please switch to Sepolia testnet (Chain ID: 11155111)`,
        5,
      );
      return null;
    }

    return provider;
  };

  // Copy text to clipboard with fallback
  const copyToClipboard = async (text: string) => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      } else {
        // Fallback for older browsers or non-secure contexts
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        return successful;
      }
    } catch (err) {
      console.error('Failed to copy:', err);
      return false;
    }
  };

  // Generate Burn Address from Secret
  const generatePrivacyAddress = async (secret: string) => {
    try {
      const poseidon = await buildPoseidon();
      const secretBigInt = BigInt(secret);
      const tokenId = 0n; // ERC-20 fixed to 0

      // Reference logic from e2e.test.js and zkProof.ts
      // addrScalar = Poseidon(8065, tokenId, secret)
      const addrScalar = poseidon.F.toString(poseidon([8065n, tokenId, secretBigInt]));
      const addr20 = BigInt(addrScalar) & ((1n << 160n) - 1n);
      const privacyAddress = ethers.getAddress('0x' + addr20.toString(16).padStart(40, '0'));

      return privacyAddress;
    } catch (error: any) {
      console.error('Error generating privacy address:', error);
      throw error;
    }
  };

  // Handle Burn button click - Open Secret input modal (Transfer page)
  const handleBurnClick = () => {
    setSecretModalVisible(true);
    // Reset state
    setSeed('');
    setSecretList([]);
    setTransferBurnAddress(null);
  };

  // Handle Deposit Directly Burn button click (Simple Mode)
  const handleDepositBurnClick = () => {
    setDepositSecretModalVisible(true);
    // Reset state
    setSeed('');
    setDepositSecretList([]);
    // Auto generate seed
    handleGenerateBySeed('deposit');
  };

  // Handle Advanced Mode Deposit Generate button click
  const handleAdvancedDepositGenerateClick = () => {
    setAdvancedDepositSecretModalVisible(true);
    // Reset state
    setSeed('');
    setAdvancedDepositSecretList([]);
    setAdvancedDepositSecretMode(undefined);
  };

  // Handle Deposit Secret confirmation - Generate Burn Address (Simple Mode)
  const handleDepositSecretConfirm = async () => {
    try {
      const values = await depositSecretForm.validateFields();
      const privacyAddress = await generatePrivacyAddress(values.secret);

      // Set to Simple Deposit form targetAddress field
      simpleDepositForm.setFieldsValue({ targetAddress: privacyAddress });

      message.success(intl.formatMessage({ id: 'pages.zwtoken.deposit.privacyAddressGenerated' }));
      setDepositSecretModalVisible(false);
      depositSecretForm.resetFields();
      setDepositSecretList([]);
    } catch (error: any) {
      if (error.errorFields) {
        // Form validation error, do nothing
        return;
      }
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.error' })}: ${
          error.message
        }`,
      );
    }
  };

  // Select Secret for Deposit page (Simple Mode)
  const handleSelectDepositSecret = async (secret: string) => {
    try {
      const privacyAddress = await generatePrivacyAddress(secret);
      // Set to Simple Deposit form targetAddress field
      simpleDepositForm.setFieldsValue({ targetAddress: privacyAddress });
      message.success(intl.formatMessage({ id: 'pages.zwtoken.deposit.privacyAddressGenerated' }));
      setDepositSecretModalVisible(false);
      depositSecretForm.resetFields();
      setDepositSecretList([]);
    } catch (error: any) {
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.error' })}: ${
          error.message
        }`,
      );
    }
  };

  // Select Secret for Advanced Mode Deposit page
  const handleSelectAdvancedDepositSecret = async (secret: string) => {
    try {
      const privacyAddress = await generatePrivacyAddress(secret);
      // Set to Advanced Deposit form targetAddress field
      advancedDepositForm.setFieldsValue({ targetAddress: privacyAddress });
      message.success(intl.formatMessage({ id: 'pages.zwtoken.deposit.privacyAddressGenerated' }));
      setAdvancedDepositSecretModalVisible(false);
      advancedDepositSecretForm.resetFields();
      setAdvancedDepositSecretList([]);
    } catch (error: any) {
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.error' })}: ${
          error.message
        }`,
      );
    }
  };

  // Handle Advanced Deposit Secret confirmation - Generate Burn Address
  const handleAdvancedDepositSecretConfirm = async () => {
    try {
      const values = await advancedDepositSecretForm.validateFields();
      const privacyAddress = await generatePrivacyAddress(values.secret);

      // Set to Advanced Deposit form targetAddress field
      advancedDepositForm.setFieldsValue({ targetAddress: privacyAddress });

      message.success(intl.formatMessage({ id: 'pages.zwtoken.deposit.privacyAddressGenerated' }));
      setAdvancedDepositSecretModalVisible(false);
      advancedDepositSecretForm.resetFields();
      setAdvancedDepositSecretList([]);
    } catch (error: any) {
      if (error.errorFields) {
        // Form validation error, do nothing
        return;
      }
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.error' })}: ${
          error.message
        }`,
      );
    }
  };

  // Generate Seed through wallet signature
  const handleGenerateBySeed = async (targetMode?: 'deposit' | 'transfer' | 'advancedDeposit') => {
    if (!wallet || !account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    try {
      setLoading(true);
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();
      const signer = await provider.getSigner();

      // Construct signature message
      const signMessage = `ZWToken: ${CONTRACT_ADDRESSES.ZWERC20}, chainId: ${network.chainId}`;

      // Request signature
      const signature = await signer.signMessage(signMessage);

      // Signature result as Seed
      setSeed(signature);

      // Generate 10 SecretBySeed
      const secrets: Array<{
        index: number;
        secret: string;
        address: string;
        amount: string;
        loading: boolean;
        isClaimed: boolean;
      }> = [];
      for (let i = 1; i <= 10; i++) {
        // Seed + index, hash
        const secretBySeed = ethers.keccak256(ethers.toUtf8Bytes(signature + i.toString()));
        // Convert to BigInt format string (remove 0x prefix)
        const secretBigInt = BigInt(secretBySeed).toString();
        secrets.push({
          index: i,
          secret: secretBigInt,
          address: '',
          amount: '-',
          loading: true,
          isClaimed: false,
        });
      }

      // Update the corresponding list based on target mode
      if (targetMode === 'deposit') {
        setDepositSecretList(secrets);
      } else if (targetMode === 'transfer') {
        setSecretList(secrets);
      } else if (targetMode === 'advancedDeposit') {
        setAdvancedDepositSecretList(secrets);
      } else {
        // Fallback: check which modal is open
        if (depositSecretModalVisible) {
          setDepositSecretList(secrets);
        } else if (advancedDepositSecretModalVisible) {
          setAdvancedDepositSecretList(secrets);
        } else {
          setSecretList(secrets);
        }
      }
      message.success(intl.formatMessage({ id: 'pages.zwtoken.message.seedGeneratedQuerying' }));

      // Query NFT balance for each burn address
      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingNFT,
        CONTRACT_ABIS.ERC721,
        provider,
      );

      // Get current token counter to know how many NFTs to scan
      const currentTokenId = await nftContract.getCurrentTokenId();
      console.log(`Scanning NFTs from tokenId 0 to ${currentTokenId - 1} for burn addresses`);

      // ZWERC721 contract for checking nullifier
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        provider,
      );

      // Query NFT count for each Secret's burn address
      for (let i = 0; i < secrets.length; i++) {
        try {
          const secret = secrets[i].secret;
          const { privacyAddress, nullifier } = await deriveFromSecret(secret);

          // Count NFTs owned by this burn address
          let nftCount = 0;
          for (let tokenId = 0; tokenId < currentTokenId; tokenId++) {
            try {
              const owner = await nftContract.ownerOf(tokenId);
              if (owner.toLowerCase() === privacyAddress.toLowerCase()) {
                nftCount++;
              }
            } catch (error) {
              // Token might be burned or not exist, skip
            }
          }

          const foundAmount = nftCount.toString();

          // Check if nullifier is already used (reminted)
          const nullifierHex = '0x' + nullifier.toString(16).padStart(64, '0');
          const isNullifierUsed = await contract.nullifierUsed(nullifierHex);

          // Address is claimed if nullifier used OR no NFTs left
          const isClaimed = isNullifierUsed || nftCount === 0;

          // Update the corresponding list based on target mode
          if (targetMode === 'deposit') {
            setDepositSecretList((prev) =>
              prev.map((item, idx) =>
                idx === i
                  ? { ...item, address: privacyAddress, amount: foundAmount, loading: false, isClaimed: isClaimed }
                  : item,
              ),
            );
          } else if (targetMode === 'transfer') {
            setSecretList((prev) =>
              prev.map((item, idx) =>
                idx === i
                  ? { ...item, address: privacyAddress, amount: foundAmount, loading: false, isClaimed: isClaimed }
                  : item,
              ),
            );
          } else if (targetMode === 'advancedDeposit') {
            setAdvancedDepositSecretList((prev) =>
              prev.map((item, idx) =>
                idx === i
                  ? { ...item, address: privacyAddress, amount: foundAmount, loading: false, isClaimed: isClaimed }
                  : item,
              ),
            );
          } else {
            // Fallback: check which modal is open
            if (depositSecretModalVisible) {
              setDepositSecretList((prev) =>
                prev.map((item, idx) =>
                  idx === i
                    ? { ...item, address: privacyAddress, amount: foundAmount, loading: false, isClaimed: isClaimed }
                    : item,
                ),
              );
            } else if (advancedDepositSecretModalVisible) {
              setAdvancedDepositSecretList((prev) =>
                prev.map((item, idx) =>
                  idx === i
                    ? { ...item, address: privacyAddress, amount: foundAmount, loading: false, isClaimed: isClaimed }
                    : item,
                ),
              );
            } else {
              setSecretList((prev) =>
                prev.map((item, idx) =>
                  idx === i
                    ? { ...item, address: privacyAddress, amount: foundAmount, loading: false, isClaimed: isClaimed }
                    : item,
                ),
              );
            }
          }
        } catch (error) {
          console.error(`Failed to query Secret ${i + 1}:`, error);
          if (targetMode === 'deposit') {
            setDepositSecretList((prev) =>
              prev.map((item, idx) =>
                idx === i
                  ? { ...item, address: '', amount: 'Query failed', loading: false, isClaimed: false }
                  : item,
              ),
            );
          } else if (targetMode === 'transfer') {
            setSecretList((prev) =>
              prev.map((item, idx) =>
                idx === i
                  ? { ...item, address: '', amount: 'Query failed', loading: false, isClaimed: false }
                  : item,
              ),
            );
          } else if (targetMode === 'advancedDeposit') {
            setAdvancedDepositSecretList((prev) =>
              prev.map((item, idx) =>
                idx === i
                  ? { ...item, address: '', amount: 'Query failed', loading: false, isClaimed: false }
                  : item,
              ),
            );
          } else {
            // Fallback: check which modal is open
            if (depositSecretModalVisible) {
              setDepositSecretList((prev) =>
                prev.map((item, idx) =>
                  idx === i
                    ? { ...item, address: '', amount: 'Query failed', loading: false, isClaimed: false }
                    : item,
                ),
              );
            } else if (advancedDepositSecretModalVisible) {
              setAdvancedDepositSecretList((prev) =>
                prev.map((item, idx) =>
                  idx === i
                    ? { ...item, address: '', amount: 'Query failed', loading: false, isClaimed: false }
                    : item,
                ),
              );
            } else {
              setSecretList((prev) =>
                prev.map((item, idx) =>
                  idx === i
                    ? { ...item, address: '', amount: 'Query failed', loading: false, isClaimed: false }
                    : item,
                ),
              );
            }
          }
        }
      }

      message.success(intl.formatMessage({ id: 'pages.zwtoken.message.queryCompleted' }));
    } catch (error: any) {
      console.error('Failed to generate Seed:', error);
      message.error(`Failed to generate Seed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Select a SecretBySeed for Transfer page
  const handleSelectSecret = async (secret: string) => {
    try {
      const privacyAddress = await generatePrivacyAddress(secret);
      // Set to Transfer form targetAddress field
      transferForm.setFieldsValue({ targetAddress: privacyAddress });
      // Save the generated burn address for later detection
      setTransferBurnAddress(privacyAddress);
      message.success(intl.formatMessage({ id: 'pages.zwtoken.transfer.generateSuccess' }));
      setSecretModalVisible(false);
      secretForm.resetFields();
      setSecretList([]);
    } catch (error: any) {
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.transfer.generateFailed' })}: ${error.message}`,
      );
    }
  };

  // Click button to open modal and generate Seed immediately
  const handleRemintGenerateBySeedClick = async () => {
    if (!wallet || !account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    // Open modal first
    setRemintSeedModalVisible(true);
    setRemintSecretList([]);

    try {
      setLoading(true);
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();
      const signer = await provider.getSigner();

      // Construct signature message
      const signMessage = `ZWToken: ${CONTRACT_ADDRESSES.ZWERC20}, chainId: ${network.chainId}`;

      // Request signature
      const signature = await signer.signMessage(signMessage);

      // Generate 10 SecretBySeed
      const secrets: Array<{
        index: number;
        secret: string;
        address: string;
        amount: string;
        loading: boolean;
        isClaimed: boolean;
      }> = [];
      for (let i = 1; i <= 10; i++) {
        // Seed + index, hash
        const secretBySeed = ethers.keccak256(ethers.toUtf8Bytes(signature + i.toString()));
        // Convert to BigInt format string (remove 0x prefix)
        const secretBigInt = BigInt(secretBySeed).toString();
        secrets.push({
          index: i,
          secret: secretBigInt,
          address: '',
          amount: '-',
          loading: true,
          isClaimed: false,
        });
      }

      setRemintSecretList(secrets);
      message.success(intl.formatMessage({ id: 'pages.zwtoken.message.seedGeneratedQuerying' }));

      // Query NFT balance for each burn address
      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingNFT,
        CONTRACT_ABIS.ERC721,
        provider,
      );

      // Get current token counter to know how many NFTs to scan
      const currentTokenId = await nftContract.getCurrentTokenId();
      console.log(`Scanning NFTs from tokenId 0 to ${currentTokenId - 1} for remint addresses`);

      // ZWERC721 contract for checking nullifier
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        provider,
      );

      // Query NFT count for each Secret's burn address
      for (let i = 0; i < secrets.length; i++) {
        try {
          const secret = secrets[i].secret;
          const { privacyAddress, nullifier } = await deriveFromSecret(secret);

          // Count NFTs owned by this burn address
          let nftCount = 0;
          for (let tokenId = 0; tokenId < currentTokenId; tokenId++) {
            try {
              const owner = await nftContract.ownerOf(tokenId);
              if (owner.toLowerCase() === privacyAddress.toLowerCase()) {
                nftCount++;
              }
            } catch (error) {
              // Token might be burned or not exist, skip
            }
          }

          const foundAmount = nftCount.toString();

          // Check if nullifier is already used (reminted)
          const nullifierHex = '0x' + nullifier.toString(16).padStart(64, '0');
          const isNullifierUsed = await contract.nullifierUsed(nullifierHex);

          // Address is claimed if nullifier used OR no NFTs left
          const isClaimed = isNullifierUsed || nftCount === 0;

          // Update state
          setRemintSecretList((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, address: privacyAddress, amount: foundAmount, loading: false, isClaimed: isClaimed }
                : item,
            ),
          );
        } catch (error) {
          console.error(`Failed to query Secret ${i + 1} amount:`, error);
          setRemintSecretList((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, address: '', amount: 'Query failed', loading: false, isClaimed: false }
                : item,
            ),
          );
        }
      }

      message.success(intl.formatMessage({ id: 'pages.zwtoken.message.queryCompleted' }));
    } catch (error: any) {
      console.error('Failed to generate Seed:', error);
      message.error(`Failed to generate Seed: ${error.message}`);
      // If failed, close modal
      setRemintSeedModalVisible(false);
    } finally {
      setLoading(false);
    }
  };

  // Select SecretBySeed for Remint page
  const handleSelectRemintSecret = (secret: string, amount: string) => {
    remintForm.setFieldsValue({ secret });

    // Set remint amount if available
    const amountNum = parseFloat(amount);
    if (!isNaN(amountNum) && amountNum > 0) {
      remintForm.setFieldsValue({ remintAmount: amountNum });
      setSelectedRemintMaxAmount(amount);
    } else {
      setSelectedRemintMaxAmount(null);
    }

    setRemintSeedModalVisible(false);
    message.success(intl.formatMessage({ id: 'pages.zwtoken.message.secretSelected' }));
  };

  // Advanced Mode Remint - Click button to open modal and generate Seed
  const handleAdvancedRemintGenerateBySeedClick = async () => {
    if (!wallet || !account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    // Open modal first
    setAdvancedRemintSeedModalVisible(true);
    setAdvancedRemintSecretList([]);

    try {
      setLoading(true);
      const provider = new ethers.BrowserProvider(wallet.provider);
      const network = await provider.getNetwork();
      const signer = await provider.getSigner();

      // Construct signature message
      const signMessage = `ZWToken: ${CONTRACT_ADDRESSES.ZWERC20}, chainId: ${network.chainId}`;

      // Request signature
      const signature = await signer.signMessage(signMessage);

      // Generate 10 SecretBySeed
      const secrets: Array<{
        index: number;
        secret: string;
        address: string;
        amount: string;
        loading: boolean;
        isClaimed: boolean;
      }> = [];
      for (let i = 1; i <= 10; i++) {
        // Seed + index, hash
        const secretBySeed = ethers.keccak256(ethers.toUtf8Bytes(signature + i.toString()));
        // Convert to BigInt format string (remove 0x prefix)
        const secretBigInt = BigInt(secretBySeed).toString();
        secrets.push({
          index: i,
          secret: secretBigInt,
          address: '',
          amount: '-',
          loading: true,
          isClaimed: false,
        });
      }

      setAdvancedRemintSecretList(secrets);
      message.success(intl.formatMessage({ id: 'pages.zwtoken.message.seedGeneratedQuerying' }));

      // Query NFT balance for each burn address
      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingNFT,
        CONTRACT_ABIS.ERC721,
        provider,
      );

      // Get current token counter to know how many NFTs to scan
      const currentTokenId = await nftContract.getCurrentTokenId();
      console.log(`Scanning NFTs from tokenId 0 to ${currentTokenId - 1} for advanced remint addresses`);

      // ZWERC721 contract for checking nullifier
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        provider,
      );

      // Query NFT count for each Secret's burn address
      for (let i = 0; i < secrets.length; i++) {
        try {
          const secret = secrets[i].secret;
          const { privacyAddress, nullifier } = await deriveFromSecret(secret);

          // Count NFTs owned by this burn address
          let nftCount = 0;
          for (let tokenId = 0; tokenId < currentTokenId; tokenId++) {
            try {
              const owner = await nftContract.ownerOf(tokenId);
              if (owner.toLowerCase() === privacyAddress.toLowerCase()) {
                nftCount++;
              }
            } catch (error) {
              // Token might be burned or not exist, skip
            }
          }

          const foundAmount = nftCount.toString();

          // Check if nullifier is already used (reminted)
          const nullifierHex = '0x' + nullifier.toString(16).padStart(64, '0');
          const isNullifierUsed = await contract.nullifierUsed(nullifierHex);

          // Address is claimed if nullifier used OR no NFTs left
          const isClaimed = isNullifierUsed || nftCount === 0;

          // Update state
          setAdvancedRemintSecretList((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, address: privacyAddress, amount: foundAmount, loading: false, isClaimed: isClaimed }
                : item,
            ),
          );
        } catch (error) {
          console.error(`Failed to query Secret ${i + 1} amount:`, error);
          setAdvancedRemintSecretList((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, address: '', amount: 'Query failed', loading: false, isClaimed: false }
                : item,
            ),
          );
        }
      }

      message.success(intl.formatMessage({ id: 'pages.zwtoken.message.queryCompleted' }));
    } catch (error: any) {
      console.error('Failed to generate Seed:', error);
      message.error(`Failed to generate Seed: ${error.message}`);
      // If failed, close modal
      setAdvancedRemintSeedModalVisible(false);
    } finally {
      setLoading(false);
    }
  };

  // Advanced Mode Remint - Select SecretBySeed
  const handleAdvancedRemintSelectSecret = (secret: string, amount: string) => {
    remintForm.setFieldsValue({ secret });

    // Set remint amount if available
    const amountNum = parseFloat(amount);
    if (!isNaN(amountNum) && amountNum > 0) {
      remintForm.setFieldsValue({ remintAmount: amountNum });
      setSelectedRemintMaxAmount(amount);
    } else {
      setSelectedRemintMaxAmount(null);
    }

    setAdvancedRemintSeedModalVisible(false);
    message.success(intl.formatMessage({ id: 'pages.zwtoken.message.secretSelected' }));
  };

  // Handle Secret confirmation - Generate Burn Address
  const handleSecretConfirm = async () => {
    try {
      const values = await secretForm.validateFields();
      const privacyAddress = await generatePrivacyAddress(values.secret);

      // Set to Transfer form targetAddress field
      transferForm.setFieldsValue({ targetAddress: privacyAddress });
      
      // Save the generated burn address for later detection
      setTransferBurnAddress(privacyAddress);

      message.success(intl.formatMessage({ id: 'pages.zwtoken.transfer.generateSuccess' }));
      setSecretModalVisible(false);
      secretForm.resetFields();
      setSecretList([]);
    } catch (error: any) {
      if (error.errorFields) {
        // Form validation error, do nothing
        return;
      }
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.transfer.generateFailed' })}: ${error.message}`,
      );
    }
  };

  // Check if approval is needed - Simple Mode (NFT uses approveForAll)
  const simpleNeedsApproval = React.useMemo(() => {
    if (!simpleDepositAmount || simpleDepositAmount <= 0) return false;
    // For NFT, allowance is either 0 (not approved) or 999999 (approved for all)
    return parseInt(allowance) === 0;
  }, [simpleDepositAmount, allowance]);

  // Check if approval is needed - Advanced Mode (NFT uses approveForAll)
  const advancedNeedsApproval = React.useMemo(() => {
    if (!advancedDepositAmount || advancedDepositAmount <= 0) return false;
    // For NFT, allowance is either 0 (not approved) or 999999 (approved for all)
    return parseInt(allowance) === 0;
  }, [advancedDepositAmount, allowance]);

  // Simple Mode Deposit (Burn) - targetAddress is required
  const handleSimpleDeposit = async (values: { amount: number; targetAddress: string }) => {
    console.log('🔵 [Simple Mode] handleSimpleDeposit called with:', values);

    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    if (!values.targetAddress) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.targetAddressRequired' }));
      return;
    }

    // 检查 NFT 余额是否足够
    const nftBalanceNum = parseInt(usdcBalance);
    if (nftBalanceNum < values.amount) {
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.error.insufficientBalance' })}: NFT ${nftBalanceNum} < ${values.amount}`
      );
      return;
    }

    // 清除之前的交易哈希
    setSimpleBurnTxHash(null);
    setLoading(true);
    try {
      const provider = await getProvider();
      if (!provider) {
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingNFT,
        CONTRACT_ABIS.ERC721,
        signer,
      );

      console.log(`[Simple] Deposit amount: ${values.amount} NFT(s)`);

      // Check if approved for all
      const isApprovedForAll = await nftContract.isApprovedForAll(
        account,
        CONTRACT_ADDRESSES.ZWERC721,
      );

      // If not approved, execute approval
      if (!isApprovedForAll) {
        console.log('[Simple] Starting approval for all...');
        message.loading(intl.formatMessage({ id: 'pages.zwtoken.deposit.approving' }), 0);
        const approveTx = await nftContract.setApprovalForAll(
          CONTRACT_ADDRESSES.ZWERC721,
          true,
        );
        await approveTx.wait();
        message.destroy();
        message.success(intl.formatMessage({ id: 'pages.zwtoken.message.approveSuccess' }));
        refreshBalances();
        setLoading(false);
        return;
      }

      console.log('[Simple] Already approved, proceeding to burn...');

      // Execute deposit with targetAddress (Burn)
      const zwnftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        signer,
      );

      // For NFT, we need to get the tokenId from user's NFTs
      // Get the first tokenId owned by user
      const currentTokenId = await nftContract.getCurrentTokenId();
      let userTokenId = -1;
      for (let tokenId = 0; tokenId < currentTokenId; tokenId++) {
        try {
          const owner = await nftContract.ownerOf(tokenId);
          if (owner.toLowerCase() === account.toLowerCase()) {
            userTokenId = tokenId;
            break;
          }
        } catch (error) {
          // Token might not exist, skip
        }
      }

      if (userTokenId === -1) {
        message.error('No NFT found to deposit');
        setLoading(false);
        return;
      }

      console.log(`[Simple] Depositing tokenId ${userTokenId} to burn address`);
      const tx = await zwnftContract.deposit(values.targetAddress, userTokenId, 1, '0x');

      message.loading(intl.formatMessage({ id: 'pages.zwtoken.deposit.submitting' }), 0);
      const receipt = await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwtoken.deposit.success' }));
      
      // 保存交易哈希以显示
      setSimpleBurnTxHash(receipt.hash);
      
      // Save Last Burn information (Simple Mode - always burn)
      const burnAmount = values.amount.toString();
      const burnAddress = values.targetAddress;
      const burnTxHash = receipt.hash;
      const burnMode = 'simple';
      
      setLastBurnAmount(burnAmount);
      setLastBurnAddress(burnAddress);
      setLastBurnTxHash(burnTxHash);
      setLastBurnMode(burnMode);
      saveLastBurnToStorage(burnAmount, burnAddress, burnTxHash, burnMode);
      
      simpleDepositForm.resetFields();
      setSimpleDepositAmount(null);
      refreshBalances();
    } catch (error: any) {
      console.error('❌ [Simple] Deposit/Approve error:', error);
      message.destroy();

      let errorMessage = error.message || 'Unknown error';
      if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
        errorMessage = 'User rejected the transaction';
      }

      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.deposit.failed' })}: ${errorMessage}`,
      );
    } finally {
      console.log('🏁 [Simple] handleSimpleDeposit finished');
      setLoading(false);
    }
  };

  // Advanced Mode Deposit (Wrap) - targetAddress is optional
  const handleAdvancedDeposit = async (values: { amount: number; targetAddress?: string }) => {
    console.log('🟢 [Advanced Mode] handleAdvancedDeposit called with:', {
      ...values,
      directBurn,
    });

    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    // 检查 NFT 余额是否足够
    const nftBalanceNum = parseInt(usdcBalance);
    if (nftBalanceNum < values.amount) {
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.error.insufficientBalance' })}: NFT ${nftBalanceNum} < ${values.amount}`
      );
      return;
    }

    // If directBurn is enabled, targetAddress is required
    if (directBurn && !values.targetAddress) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.targetAddressRequired' }));
      return;
    }

    // 清除之前的交易哈希
    setAdvancedDepositTxHash(null);
    setLoading(true);
    try {
      const provider = await getProvider();
      if (!provider) {
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      const nftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.UnderlyingNFT,
        CONTRACT_ABIS.ERC721,
        signer,
      );

      console.log(`[Advanced] Deposit amount: ${values.amount} NFT(s)`);

      // Check if approved for all
      const isApprovedForAll = await nftContract.isApprovedForAll(
        account,
        CONTRACT_ADDRESSES.ZWERC721,
      );

      console.log('[Advanced] Approval check:', {
        isApprovedForAll,
        needsApproval: !isApprovedForAll,
      });

      // If not approved, execute approval
      if (!isApprovedForAll) {
        console.log('[Advanced] Starting approval for all...');
        message.loading(intl.formatMessage({ id: 'pages.zwtoken.deposit.approving' }), 0);
        const approveTx = await nftContract.setApprovalForAll(
          CONTRACT_ADDRESSES.ZWERC721,
          true,
        );
        await approveTx.wait();
        message.destroy();
        message.success(intl.formatMessage({ id: 'pages.zwtoken.message.approveSuccess' }));
        refreshBalances();
        setLoading(false);
        return;
      }

      console.log('[Advanced] Already approved, proceeding to wrap...');

      // Execute deposit
      const zwnftContract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC721,
        CONTRACT_ABIS.ZWERC721,
        signer,
      );

      // For NFT, we need to get the tokenId from user's NFTs
      // Get the first tokenId owned by user
      const currentTokenId = await nftContract.getCurrentTokenId();
      let userTokenId = -1;
      for (let tokenId = 0; tokenId < currentTokenId; tokenId++) {
        try {
          const owner = await nftContract.ownerOf(tokenId);
          if (owner.toLowerCase() === account.toLowerCase()) {
            userTokenId = tokenId;
            break;
          }
        } catch (error) {
          // Token might not exist, skip
        }
      }

      if (userTokenId === -1) {
        message.error('No NFT found to deposit');
        setLoading(false);
        return;
      }

      // Determine to address: use targetAddress if provided (burn mode), otherwise use account
      const toAddress = values.targetAddress || account;
      console.log(`[Advanced] Depositing tokenId ${userTokenId} to ${toAddress}`);
      const tx = await zwnftContract.deposit(toAddress, userTokenId, 1, '0x');

      message.loading(intl.formatMessage({ id: 'pages.zwtoken.deposit.submitting' }), 0);
      const receipt = await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwtoken.deposit.success' }));
      
      // 保存交易哈希以显示
      setAdvancedDepositTxHash(receipt.hash);
      
      // Save Last Burn information (Advanced Mode with Direct Burn)
      // directBurn checkbox determines if this is a burn operation
      if (directBurn && values.targetAddress) {
        const burnAmount = values.amount.toString();
        const burnAddress = values.targetAddress;
        const burnTxHash = receipt.hash;
        const burnMode = 'advanced';
        
        setLastBurnAmount(burnAmount);
        setLastBurnAddress(burnAddress);
        setLastBurnTxHash(burnTxHash);
        setLastBurnMode(burnMode);
        saveLastBurnToStorage(burnAmount, burnAddress, burnTxHash, burnMode);
      }
      
      advancedDepositForm.resetFields();
      setAdvancedDepositAmount(null);
      setDirectBurn(false);
      refreshBalances();
    } catch (error: any) {
      console.error('❌ [Advanced] Deposit/Approve error:', error);
      message.destroy();

      let errorMessage = error.message || 'Unknown error';
      if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
        errorMessage = 'User rejected the transaction';
      }

      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.deposit.failed' })}: ${errorMessage}`,
      );
    } finally {
      console.log('🏁 [Advanced] handleAdvancedDeposit finished');
      setLoading(false);
    }
  };

  // Withdraw operation
  const handleWithdraw = async (values: { amount: number }) => {
    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    // 检查 ZWNFT 余额是否足够
    const zwnftBalanceNum = parseInt(zwusdcBalance);
    if (zwnftBalanceNum < values.amount) {
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.error.insufficientBalance' })}: ZWNFT ${zwnftBalanceNum} < ${values.amount}`
      );
      return;
    }

    // 清除之前的交易哈希
    setAdvancedWithdrawTxHash(null);
    setLoading(true);
    try {
      const provider = await getProvider();
      if (!provider) {
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      // Use contract address from config file
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC20,
        CONTRACT_ABIS.ZWERC20,
        signer,
      );

      // Use correct decimals
      const withdrawAmount = ethers.parseUnits(values.amount.toString(), tokenDecimals);
      console.log(
        `Withdraw amount: ${
          values.amount
        } tokens = ${withdrawAmount.toString()} units (${tokenDecimals} decimals)`,
      );

      // withdraw(address to, uint256 id, uint256 amount, bytes data)
      const signerAddress = await signer.getAddress();
      const tx = await contract.withdraw(signerAddress, 0, withdrawAmount, '0x');

      message.loading(intl.formatMessage({ id: 'pages.zwtoken.withdraw.submitting' }), 0);
      const receipt = await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwtoken.withdraw.success' }));
      
      // 保存交易哈希以显示
      setAdvancedWithdrawTxHash(receipt.hash);
      
      withdrawForm.resetFields();
      // Refresh balances
      refreshBalances();
    } catch (error: any) {
      message.destroy();
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.withdraw.failed' })}: ${error.message}`,
      );
    } finally {
      setLoading(false);
    }
  };

  // Transfer operation
  const handleTransfer = async (values: { targetAddress: string; amount: number }) => {
    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    // 检查 ZWNFT 余额是否足够
    const zwnftBalanceNum = parseInt(zwusdcBalance);
    if (zwnftBalanceNum < values.amount) {
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.error.insufficientBalance' })}: ZWNFT ${zwnftBalanceNum} < ${values.amount}`
      );
      return;
    }

    // 清除之前的交易哈希
    setAdvancedTransferTxHash(null);
    setLoading(true);
    try {
      const provider = await getProvider();
      if (!provider) {
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      // Use contract address from config file
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC20,
        CONTRACT_ABIS.ZWERC20,
        signer,
      );

      // Use correct decimals
      const transferAmount = ethers.parseUnits(values.amount.toString(), tokenDecimals);
      console.log(
        `Transfer amount: ${
          values.amount
        } tokens = ${transferAmount.toString()} units (${tokenDecimals} decimals)`,
      );

      const tx = await contract.transfer(values.targetAddress, transferAmount);

      message.loading(intl.formatMessage({ id: 'pages.zwtoken.transfer.submitting' }), 0);
      const receipt = await tx.wait();
      message.destroy();
      message.success(intl.formatMessage({ id: 'pages.zwtoken.transfer.success' }));
      
      // 保存交易哈希以显示
      setAdvancedTransferTxHash(receipt.hash);
      
      // Save Last Burn information (Transfer with Burn address)
      // If the target address matches the saved burn address, this is a burn transfer
      if (transferBurnAddress && values.targetAddress.toLowerCase() === transferBurnAddress.toLowerCase()) {
        const burnAmount = values.amount.toString();
        const burnAddress = values.targetAddress;
        const burnTxHash = receipt.hash;
        const burnMode = 'simple';
        
        setLastBurnAmount(burnAmount);
        setLastBurnAddress(burnAddress);
        setLastBurnTxHash(burnTxHash);
        setLastBurnMode(burnMode);
        saveLastBurnToStorage(burnAmount, burnAddress, burnTxHash, burnMode);
      }
      
      transferForm.resetFields();
      setTransferBurnAddress(null); // Clear the saved burn address
      // Refresh balances
      refreshBalances();
    } catch (error: any) {
      message.destroy();
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.transfer.failed' })}: ${error.message}`,
      );
    } finally {
      setLoading(false);
    }
  };

  // Remint operation
  const handleRemint = async (values: any) => {
    if (!account) {
      message.error(intl.formatMessage({ id: 'pages.zwtoken.error.connectWallet' }));
      return;
    }

    // 清除之前的交易哈希（根据当前模式）
    if (activeMainTab === 'simple') {
      setSimpleRemintTxHash(null);
    } else {
      setAdvancedRemintTxHash(null);
    }
    setLoading(true);
    const hideLoading = message.loading(
      intl.formatMessage({ id: 'pages.zwtoken.remint.preparing' }),
      0,
    );

    try {
      const provider = await getProvider();
      if (!provider) {
        hideLoading();
        setLoading(false);
        return;
      }

      const signer = await provider.getSigner();

      // Use contract address from config file
      const contract = new ethers.Contract(
        CONTRACT_ADDRESSES.ZWERC20,
        CONTRACT_ABIS.ZWERC20,
        signer,
      );

      // === Step 1: Derive parameters from Secret ===
      console.log('Step 1: Deriving from secret...');
      const { privacyAddress, addr20, q, nullifier, secret } = await deriveFromSecret(
        values.secret,
      );
      console.log(`Privacy address: ${privacyAddress}`);
      console.log(`Nullifier: 0x${nullifier.toString(16)}`);

      // Check if nullifier is already used
      const nullifierHex = '0x' + nullifier.toString(16).padStart(64, '0');
      const isNullifierUsed = await contract.nullifierUsed(nullifierHex);
      if (isNullifierUsed) {
        hideLoading();
        message.error(intl.formatMessage({ id: 'pages.zwtoken.remint.nullifierUsed' }));
        return;
      }

      // Check if privacy address still has balance
      const currentBalance = await contract.balanceOf(privacyAddress);
      if (currentBalance === 0n) {
        hideLoading();
        message.error(
          intl.formatMessage({ id: 'pages.zwtoken.message.privacyAddressZeroBalance' }),
        );
        return;
      }

      // === Step 2: Rebuild Merkle tree from chain ===
      hideLoading();
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.remint.rebuildingTree' }), 0);
      console.log('Step 2: Rebuilding Merkle tree from chain...');

      const poseidon = await buildPoseidon();
      const tree = await rebuildMerkleTree(contract, poseidon);

      const onchainRoot = await contract.root();
      const localRoot = '0x' + tree.root.toString(16).padStart(64, '0');
      console.log(`On-chain root: ${onchainRoot}`);
      console.log(`Local root:    ${localRoot}`);

      if (localRoot !== onchainRoot) {
        message.destroy();
        message.error(intl.formatMessage({ id: 'pages.zwtoken.remint.rootMismatch' }));
        return;
      }

      // === Step 3: Find user's commitment ===
      message.destroy();
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.remint.findingCommitment' }), 0);
      console.log('Step 3: Finding user commitment...');

      const userCommitment = await findUserCommitment(contract, privacyAddress, poseidon);
      if (!userCommitment) {
        message.destroy();
        message.error(intl.formatMessage({ id: 'pages.zwtoken.remint.commitmentNotFound' }));
        return;
      }

      console.log(`Found commitment at index ${userCommitment.index}`);
      console.log(`First amount: ${ethers.formatUnits(userCommitment.amount, tokenDecimals)}`);

      // Verify remint amount does not exceed first amount
      const remintAmount = ethers.parseUnits(values.remintAmount.toString(), tokenDecimals);
      console.log(
        `Remint amount: ${
          values.remintAmount
        } tokens = ${remintAmount.toString()} units (${tokenDecimals} decimals)`,
      );

      if (remintAmount > userCommitment.amount) {
        message.destroy();
        message.error(intl.formatMessage({ id: 'pages.zwtoken.remint.amountExceeded' }));
        return;
      }

      // === Step 4: Generate Merkle proof ===
      message.destroy();
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.remint.generatingProof' }), 0);
      console.log('Step 4: Generating Merkle proof...');

      const merkleProof = tree.getProof(userCommitment.index);
      console.log(`Merkle proof generated (${merkleProof.pathElements.length} elements)`);

      // === Step 5: Prepare circuit input ===
      const redeem = values.redeem || false;
      const relayerFee = values.relayerFee || 0;

      const circuitInput = prepareCircuitInput({
        root: tree.root,
        nullifier,
        recipient: values.recipient,
        remintAmount: remintAmount, // Already BigInt
        id: 0n,
        redeem: redeem,
        relayerFee: BigInt(relayerFee), // Convert to BigInt
        secret,
        addr20,
        commitAmount: userCommitment.amount,
        q,
        merkleProof,
      });

      console.log('Circuit input prepared:', circuitInput);

      // === Step 6: Generate ZK proof ===
      message.destroy();
      message.loading(intl.formatMessage({ id: 'pages.zwtoken.remint.generatingZKProof' }), 0);
      console.log('Step 6: Generating ZK proof (this may take 10-30 seconds)...');

      try {
        // Use circuit to generate real ZK proof (if preloaded, browser will read from cache)
        const { proof: zkProof, publicSignals } = await snarkjs.groth16.fullProve(
          circuitInput,
          '/circuits/remint.wasm',
          '/circuits/remint_final.zkey',
        );

        console.log('✅ ZK proof generated!');
        console.log('Public signals:', publicSignals);

        // Format as Solidity calldata
        const calldata = await snarkjs.groth16.exportSolidityCallData(zkProof, publicSignals);
        const calldataJson = JSON.parse('[' + calldata + ']');

        const solidityProof = {
          a: calldataJson[0],
          b: calldataJson[1],
          c: calldataJson[2],
        };

        console.log('✅ Proof formatted for Solidity');

        // Encode proof bytes
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const proofBytes = abiCoder.encode(
          ['uint256[2]', 'uint256[2][2]', 'uint256[2]'],
          [solidityProof.a, solidityProof.b, solidityProof.c],
        );

        // === Step 7: Submit remint transaction ===
        message.destroy();
        message.loading(intl.formatMessage({ id: 'pages.zwtoken.remint.submitting' }), 0);
        console.log('Step 7: Submitting remint transaction...');

        // Encode relayerData if relayerFee > 0
        let relayerData = '0x';
        if (relayerFee > 0) {
          relayerData = abiCoder.encode(['uint256'], [relayerFee]);
        }

        const tx = await contract.remint(
          values.recipient, // to
          0, // id (ERC-20)
          remintAmount, // amount
          {
            // RemintData struct (ERC-8065 spec)
            commitment: localRoot,
            nullifiers: [nullifierHex],
            proverData: '0x',
            relayerData: relayerData,
            redeem: redeem, // redeem flag is now inside RemintData
            proof: proofBytes,
          },
        );

        console.log('Transaction submitted, waiting for confirmation...');
        const receipt = await tx.wait();

        message.destroy();
        message.success(intl.formatMessage({ id: 'pages.zwtoken.remint.success' }));
        console.log(`✅ Remint succeeded! Gas used: ${receipt.gasUsed}`);

        // 保存交易哈希以显示（根据当前模式）
        if (activeMainTab === 'simple') {
          setSimpleRemintTxHash(receipt.hash);
        } else {
          setAdvancedRemintTxHash(receipt.hash);
        }

        remintForm.resetFields();
        setSelectedRemintMaxAmount(null);
        // Refresh balances
        refreshBalances();
      } catch (proofError: any) {
        message.destroy();
        console.error('ZK proof generation or remint error:', proofError);
        message.error(
          `${intl.formatMessage({ id: 'pages.zwtoken.remint.failed' })}: ${proofError.message}`,
        );
      }
    } catch (error: any) {
      message.destroy();
      console.error('Remint error:', error);
      message.error(
        `${intl.formatMessage({ id: 'pages.zwtoken.remint.failed' })}: ${error.message}`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageContainer
      header={{
        title: (
          <div
            style={{
              wordBreak: 'break-word',
              whiteSpace: 'normal',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              maxWidth: '100%',
            }}
          >
            <span>{intl.formatMessage({ id: 'pages.zwtoken.title' })}</span>
            <a
              href="https://eips.ethereum.org/EIPS/eip-8065"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#1890ff',
                fontSize: '18px',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              We propose <span style={{ textDecoration: 'underline' }}>ERC-8065</span>: Zero
              Knowledge Token Wrapper to achieve our goal.
            </a>
          </div>
        ),
      }}
    >
      {/* Balance display card */}
      <div
        style={{
          marginBottom: 24,
          padding: '20px',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: 8,
          cursor: account ? 'default' : 'pointer',
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onClick={() => {
          if (!account) {
            connect();
          }
        }}
        onMouseEnter={(e) => {
          if (!account) {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 8px 16px rgba(102, 126, 234, 0.3)';
          }
        }}
        onMouseLeave={(e) => {
          if (!account) {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }
        }}
      >
          {/* Faucet tip */}
          <div
            style={{
              marginBottom: 16,
              paddingBottom: 16,
              borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ color: '#fff', fontSize: 14 }}>
              💡 {intl.formatMessage({ id: 'pages.zwtoken.faucet.tip' })}
            </span>
            <a
              href="https://www.alchemy.com/faucets/ethereum-sepolia"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#fff',
                fontSize: 14,
                fontWeight: 'bold',
                textDecoration: 'underline',
                textDecorationColor: 'rgba(255, 255, 255, 0.8)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {intl.formatMessage({ id: 'pages.zwtoken.faucet.eth' })}
            </a>
            <span style={{ color: 'rgba(255, 255, 255, 0.8)', fontSize: 14 }}>|</span>
            <a
              href="https://faucet.circle.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#fff',
                fontSize: 14,
                fontWeight: 'bold',
                textDecoration: 'underline',
                textDecorationColor: 'rgba(255, 255, 255, 0.8)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {intl.formatMessage({ id: 'pages.zwtoken.faucet.usdc' })}
            </a>
          </div>

          {/* Balance information */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'space-around',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <div style={{ flex: '1 1 200px', minWidth: '200px' }}>
              <div
                style={{
                  fontSize: 14,
                  color: 'rgba(255, 255, 255, 0.8)',
                  marginBottom: 8,
                }}
              >
                {intl.formatMessage({ id: 'pages.zwtoken.balance.usdc' })}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 'bold',
                  color: '#fff',
                  wordBreak: 'break-all',
                }}
              >
                {account ? (
                  <>
                    {parseInt(usdcBalance)}{' '}
                    <a
                      href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.UnderlyingNFT}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: '#fff',
                        textDecoration: 'underline',
                        textDecorationColor: 'rgba(255, 255, 255, 0.6)',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      NFT
                    </a>
                  </>
                ) : (
                  <span style={{ fontSize: 16, opacity: 0.9 }}>
                    {intl.formatMessage({ id: 'pages.zwtoken.balance.clickToConnect' })}
                  </span>
                )}
              </div>
            </div>

            {!isMobile && (
              <div
                style={{
                  width: 1,
                  height: 60,
                  background: 'rgba(255, 255, 255, 0.2)',
                }}
              />
            )}

            <div style={{ flex: '1 1 200px', minWidth: '200px' }}>
              <div
                style={{
                  fontSize: 14,
                  color: 'rgba(255, 255, 255, 0.8)',
                  marginBottom: 8,
                }}
              >
                {intl.formatMessage({ id: 'pages.zwtoken.balance.zwusdc' })}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 'bold',
                  color: '#fff',
                  wordBreak: 'break-all',
                }}
              >
                {account ? (
                  <>
                    {parseInt(zwusdcBalance)}{' '}
                    <a
                      href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESSES.ZWERC721}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: '#fff',
                        textDecoration: 'underline',
                        textDecorationColor: 'rgba(255, 255, 255, 0.6)',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      ZWNFT
                    </a>
                  </>
                ) : (
                  <span style={{ fontSize: 16, opacity: 0.9 }}>
                    {intl.formatMessage({ id: 'pages.zwtoken.balance.clickToConnect' })}
                  </span>
                )}
              </div>
            </div>

            {!isMobile && (
              <div
                style={{
                  width: 1,
                  height: 60,
                  background: 'rgba(255, 255, 255, 0.2)',
                }}
              />
            )}

            <div
              style={{
                flex: '1 1 200px',
                minWidth: '200px',
              }}
            >
              <div
                style={{
                  fontSize: 14,
                  color: 'rgba(255, 255, 255, 0.8)',
                  marginBottom: 8,
                }}
              >
                {intl.formatMessage({ id: 'pages.zwtoken.balance.remintable' })}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 'bold',
                  color: '#fff',
                  wordBreak: 'break-all',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: account ? 'pointer' : 'default',
                }}
                onClick={(e) => {
                  if (account) {
                    e.stopPropagation();
                    // Switch to remint tab based on current mode
                    if (activeMainTab === 'simple') {
                      setActiveSimpleTab('remint');
                      // Trigger the Select button action after tab switch
                      setTimeout(() => {
                        handleRemintGenerateBySeedClick();
                      }, 100);
                    } else {
                      setActiveAdvancedTab('remint');
                      // Trigger the Select button action for Advanced mode after tab switch
                      setTimeout(() => {
                        handleAdvancedRemintGenerateBySeedClick();
                      }, 100);
                    }
                    // Scroll to the card
                    setTimeout(() => {
                      const card = document.querySelector('.ant-card');
                      if (card) {
                        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }, 100);
                  }
                }}
              >
                {account ? (
                  <>
                    <span>****</span>
                    <Button
                      type="primary"
                      size="small"
                      style={{
                        background: 'rgba(255, 255, 255, 0.2)',
                        border: 'none',
                        color: '#fff',
                      }}
                    >
                      {intl.formatMessage({ id: 'pages.zwtoken.balance.scan' })}
                    </Button>
                  </>
                ) : (
                  <span style={{ fontSize: 16, opacity: 0.9 }}>
                    {intl.formatMessage({ id: 'pages.zwtoken.balance.clickToConnect' })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

      {/* Last Burn Information card */}
      {lastBurnAmount && lastBurnAddress && (
        <div
          style={{
            marginBottom: 24,
            padding: '20px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderRadius: 8,
            position: 'relative',
          }}
        >
          {/* Close button */}
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={clearLastBurnInfo}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              color: '#fff',
              padding: 4,
              height: 'auto',
              minWidth: 'auto',
            }}
            title="Clear burn information"
          />
          <div style={{ color: '#fff' }}>
            <h3 style={{ color: '#fff', marginBottom: 16, fontSize: 18, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 8 }}>
              🔥 Last Burn Information
              <Tooltip title={intl.formatMessage({ id: 'pages.zwtoken.lastBurn.infoTooltip' })}>
                <InfoCircleOutlined style={{ fontSize: 16, cursor: 'pointer', opacity: 0.7 }} />
              </Tooltip>
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Amount */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, opacity: 0.9, minWidth: 80 }}>Amount:</span>
                <span style={{ fontSize: 16, fontWeight: 'bold' }}>
                  {parseInt(lastBurnAmount)} NFT{parseInt(lastBurnAmount) > 1 ? 's' : ''}
                </span>
              </div>

              {/* Address */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, opacity: 0.9, minWidth: 80 }}>Address:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                  <span
                    style={{
                      fontSize: isMobile ? 12 : 14,
                      fontFamily: 'monospace',
                      wordBreak: 'break-all',
                      flex: 1,
                    }}
                  >
                    {lastBurnAddress}
                  </span>
                  <Button
                    type="link"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={async () => {
                      const success = await copyToClipboard(lastBurnAddress);
                      if (success) {
                        message.success('Address copied!');
                      } else {
                        message.error('Failed to copy');
                      }
                    }}
                    style={{ color: '#fff', padding: 0, height: 'auto' }}
                  />
                </div>
              </div>

              {/* Transaction Hash */}
              {lastBurnTxHash && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, opacity: 0.9, minWidth: 80 }}>Tx Hash:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <a
                      href={`https://sepolia.etherscan.io/tx/${lastBurnTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: isMobile ? 12 : 14,
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                        flex: 1,
                        color: '#fff',
                        textDecoration: 'underline',
                      }}
                    >
                      {lastBurnTxHash}
                    </a>
                    <Button
                      type="link"
                      size="small"
                      icon={<CopyOutlined />}
                      onClick={async () => {
                        const success = await copyToClipboard(lastBurnTxHash);
                        if (success) {
                          message.success('Transaction hash copied!');
                        } else {
                          message.error('Failed to copy');
                        }
                      }}
                      style={{ color: '#fff', padding: 0, height: 'auto' }}
                    />
                  </div>
                </div>
              )}

              {/* Tip with Remint button */}
              <div
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: 'rgba(255, 255, 255, 0.15)',
                  borderRadius: 4,
                  fontSize: 12,
                  opacity: 0.95,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <span>💡 {intl.formatMessage({ id: 'pages.zwtoken.lastBurn.remintTip' })}</span>
                <Button
                  type="primary"
                  size="small"
                  onClick={() => {
                    // Switch to remint tab based on current mode
                    if (activeMainTab === 'simple') {
                      setActiveSimpleTab('remint');
                    } else {
                      setActiveAdvancedTab('remint');
                    }
                    // Scroll to the card
                    setTimeout(() => {
                      const card = document.querySelector('.ant-card');
                      if (card) {
                        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }
                    }, 100);
                  }}
                  style={{
                    background: 'rgba(255, 255, 255, 0.2)',
                    border: 'none',
                    color: '#fff',
                  }}
                >
                  {intl.formatMessage({ id: 'pages.zwtoken.lastBurn.goToRemint' })}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Card>
        {/* Outer main Tab: Simple Mode and Advanced Mode */}
        <Tabs 
          defaultActiveKey="simple" 
          type="card" 
          size="large"
          onChange={(key) => setActiveMainTab(key)}
        >
          {/* Simple Mode - Only includes Burn and Remint */}
          <TabPane tab="Simple Mode" key="simple">
            <Tabs 
              activeKey={activeSimpleTab}
              onChange={(key) => setActiveSimpleTab(key)}
              type="line" 
              style={{ marginTop: 16 }}
            >
              <TabPane tab={intl.formatMessage({ id: 'pages.zwtoken.tab.burn' })} key="burn">
                <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
                  <Form form={simpleDepositForm} layout="vertical" onFinish={handleSimpleDeposit}>
                    <Form.Item
                      label={intl.formatMessage({ id: 'pages.zwtoken.burn.amount' })}
                      name="amount"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({ id: 'pages.zwtoken.burn.amount.required' }),
                        },
                        {
                          type: 'number',
                          min: 0.000001,
                          message: intl.formatMessage({ id: 'pages.zwtoken.burn.amount.min' }),
                        },
                      ]}
                    >
                      <InputNumber
                        style={{ width: '100%' }}
                        placeholder={intl.formatMessage({
                          id: 'pages.zwtoken.burn.amount.placeholder',
                        })}
                        precision={6}
                        min={0}
                        onChange={(value) => setSimpleDepositAmount(value)}
                      />
                    </Form.Item>

                    {account && (
                      <div
                        style={{
                          marginTop: -16,
                          marginBottom: 16,
                          color: '#999',
                          fontSize: '12px',
                        }}
                      >
                        {intl.formatMessage({ id: 'pages.zwtoken.deposit.currentAllowance' })}:{' '}
                        {parseInt(allowance) > 0 ? 'Approved for All' : 'Not Approved'}
                      </div>
                    )}

                    <Form.Item
                      label={intl.formatMessage({ id: 'pages.zwtoken.burn.address' })}
                      name="targetAddress"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.burn.address.required',
                          }),
                        },
                        {
                          pattern: /^0x[a-fA-F0-9]{40}$/,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.transfer.targetAddress.invalid',
                          }),
                        },
                      ]}
                    >
                      <Input
                        placeholder={intl.formatMessage({
                          id: 'pages.zwtoken.burn.address.placeholder',
                        })}
                        maxLength={42}
                        addonBefore={
                          <Button
                            type="link"
                            onClick={handleDepositBurnClick}
                            style={{ padding: 0, height: 'auto', whiteSpace: 'nowrap' }}
                          >
                            {intl.formatMessage({ id: 'pages.zwtoken.burn.generate' })}
                          </Button>
                        }
                      />
                    </Form.Item>

                    <Form.Item>
                      <Button type="primary" htmlType="submit" loading={loading} block>
                        {simpleNeedsApproval
                          ? 'Approve'
                          : intl.formatMessage({ id: 'pages.zwtoken.burn.button' })}
                      </Button>
                    </Form.Item>

                    {/* 显示交易哈希 */}
                    {simpleBurnTxHash && (
                      <div style={{ marginTop: 12, textAlign: 'center' }}>
                        <span style={{ color: '#52c41a', fontSize: '14px' }}>
                          Tx Submitted:{' '}
                          <a
                            href={`https://sepolia.etherscan.io/tx/${simpleBurnTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#1890ff', textDecoration: 'underline' }}
                          >
                            {simpleBurnTxHash.substring(0, 10)}...{simpleBurnTxHash.substring(simpleBurnTxHash.length - 8)}
                          </a>
                        </span>
                      </div>
                    )}
                  </Form>

                  <div
                    style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}
                  >
                    <h4>{intl.formatMessage({ id: 'pages.zwtoken.burn.tip.title' })}</h4>
                    <p>
                      <strong>{intl.formatMessage({ id: 'pages.zwtoken.burn.tip.what' })}</strong>
                    </p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.burn.tip.whatDesc' })}</p>
                    <p>
                      <strong>{intl.formatMessage({ id: 'pages.zwtoken.burn.tip.how' })}</strong>
                    </p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.burn.tip.step1' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.burn.tip.step2' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.burn.tip.step3' })}</p>
                  </div>
                </div>
              </TabPane>

              <TabPane tab={intl.formatMessage({ id: 'pages.zwtoken.tab.remint' })} key="remint">
                <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
                  <Form
                    form={remintForm}
                    layout="vertical"
                    onFinish={handleRemint}
                    initialValues={{
                      recipient: account || undefined,
                      redeem: true,
                    }}
                  >
                    <Form.Item
                      label={intl.formatMessage({ id: 'pages.zwtoken.remint.secret' })}
                      name="secret"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.remint.secret.required',
                          }),
                        },
                      ]}
                    >
                      <Input.Password
                        placeholder={intl.formatMessage({
                          id: 'pages.zwtoken.remint.secret.placeholder',
                        })}
                        addonBefore={
                          <Button
                            type="link"
                            onClick={handleRemintGenerateBySeedClick}
                            style={{ padding: 0, height: 'auto', whiteSpace: 'nowrap' }}
                          >
                            {isMobile
                              ? intl.formatMessage({ id: 'pages.zwtoken.remint.select' })
                              : intl.formatMessage({
                                  id: 'pages.zwtoken.remint.selectSecretBySeed',
                                })}
                          </Button>
                        }
                      />
                    </Form.Item>

                    <Form.Item
                      label={intl.formatMessage({ id: 'pages.zwtoken.remint.recipient' })}
                      name="recipient"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.remint.recipient.required',
                          }),
                        },
                        {
                          pattern: /^0x[a-fA-F0-9]{40}$/,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.remint.recipient.invalid',
                          }),
                        },
                      ]}
                    >
                      <Input
                        placeholder={
                          account ||
                          intl.formatMessage({
                            id: 'pages.zwtoken.remint.recipient.placeholder',
                          })
                        }
                        maxLength={42}
                      />
                    </Form.Item>

                    <Form.Item
                      label={intl.formatMessage({ id: 'pages.zwtoken.remint.amount' })}
                      name="remintAmount"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.remint.amount.required',
                          }),
                        },
                        {
                          type: 'number',
                          min: 0.000001,
                          message: intl.formatMessage({ id: 'pages.zwtoken.remint.amount.min' }),
                        },
                      ]}
                    >
                      <InputNumber
                        style={{ width: '100%' }}
                        placeholder={intl.formatMessage({
                          id: 'pages.zwtoken.remint.amount.placeholder',
                        })}
                        precision={6}
                        min={0}
                      />
                    </Form.Item>

                    {selectedRemintMaxAmount && parseFloat(selectedRemintMaxAmount) > 0 && (
                      <div
                        style={{
                          marginTop: -16,
                          marginBottom: 16,
                          color: '#1890ff',
                          fontSize: '12px',
                        }}
                      >
                        💡 {intl.formatMessage({ id: 'pages.zwtoken.remint.maxAmountTip' })}:{' '}
                        {parseFloat(selectedRemintMaxAmount).toFixed(6)} USDC
                      </div>
                    )}

                    <Form.Item name="relayerFee" initialValue={0} hidden>
                      <InputNumber />
                    </Form.Item>

                    <Form.Item name="redeem" valuePropName="checked" initialValue={true} hidden>
                      <Checkbox>
                        {intl.formatMessage({ id: 'pages.zwtoken.remint.redeem' })}
                      </Checkbox>
                    </Form.Item>

                    <Form.Item>
                      <Button type="primary" htmlType="submit" loading={loading} block>
                        {intl.formatMessage({ id: 'pages.zwtoken.remint.button' })}
                      </Button>
                    </Form.Item>

                    {/* 显示交易哈希 */}
                    {simpleRemintTxHash && (
                      <div style={{ marginTop: 12, textAlign: 'center' }}>
                        <span style={{ color: '#52c41a', fontSize: '14px' }}>
                          Tx Submitted:{' '}
                          <a
                            href={`https://sepolia.etherscan.io/tx/${simpleRemintTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#1890ff', textDecoration: 'underline' }}
                          >
                            {simpleRemintTxHash.substring(0, 10)}...{simpleRemintTxHash.substring(simpleRemintTxHash.length - 8)}
                          </a>
                        </span>
                      </div>
                    )}
                  </Form>

                  <div
                    style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}
                  >
                    <h4>
                      {intl.formatMessage({ id: 'pages.zwtoken.remint.simpleMode.tip.title' })}
                    </h4>
                    <p>
                      <strong>
                        {intl.formatMessage({ id: 'pages.zwtoken.remint.simpleMode.tip.what' })}
                      </strong>
                    </p>
                    <p>
                      {intl.formatMessage({ id: 'pages.zwtoken.remint.simpleMode.tip.whatDesc' })}
                    </p>
                    <p>
                      <strong>
                        {intl.formatMessage({ id: 'pages.zwtoken.remint.simpleMode.tip.how' })}
                      </strong>
                    </p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.remint.simpleMode.tip.step1' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.remint.simpleMode.tip.step2' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.remint.simpleMode.tip.step3' })}</p>
                    <p style={{ color: '#1890ff', marginTop: 12 }}>
                      <strong>
                        {intl.formatMessage({ id: 'pages.zwtoken.remint.simpleMode.tip.note' })}
                      </strong>{' '}
                      {intl.formatMessage({ id: 'pages.zwtoken.remint.simpleMode.tip.noteDesc' })}
                    </p>
                  </div>
                </div>
              </TabPane>
            </Tabs>
          </TabPane>

          {/* Advanced Mode - Includes all four Tabs */}
          <TabPane tab="Advanced Mode" key="advanced">
            <Tabs 
              activeKey={activeAdvancedTab}
              onChange={(key) => setActiveAdvancedTab(key)}
              type="line" 
              style={{ marginTop: 16 }}
            >
              <TabPane tab={intl.formatMessage({ id: 'pages.zwtoken.tab.wrap' })} key="deposit">
                <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
                  <Form
                    form={advancedDepositForm}
                    layout="vertical"
                    onFinish={handleAdvancedDeposit}
                  >
                    <Form.Item
                      label={intl.formatMessage({ id: 'pages.zwtoken.deposit.amount' })}
                      name="amount"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.deposit.amount.required',
                          }),
                        },
                        {
                          type: 'number',
                          min: 0.000001,
                          message: intl.formatMessage({ id: 'pages.zwtoken.deposit.amount.min' }),
                        },
                      ]}
                    >
                      <InputNumber
                        style={{ width: '100%' }}
                        placeholder={intl.formatMessage({
                          id: 'pages.zwtoken.deposit.amount.placeholder',
                        })}
                        precision={6}
                        min={0}
                        onChange={(value) => setAdvancedDepositAmount(value)}
                      />
                    </Form.Item>

                    {account && (
                      <div
                        style={{
                          marginTop: -16,
                          marginBottom: 16,
                          color: '#999',
                          fontSize: '12px',
                        }}
                      >
                        {intl.formatMessage({ id: 'pages.zwtoken.deposit.currentAllowance' })}:{' '}
                        {parseInt(allowance) > 0 ? 'Approved for All' : 'Not Approved'}
                      </div>
                    )}

                    <Form.Item>
                      <Checkbox
                        checked={directBurn}
                        onChange={(e) => {
                          setDirectBurn(e.target.checked);
                          if (!e.target.checked) {
                            advancedDepositForm.setFieldsValue({ targetAddress: undefined });
                          }
                        }}
                      >
                        {intl.formatMessage({ id: 'pages.zwtoken.deposit.directBurn' })}
                      </Checkbox>
                    </Form.Item>

                    {directBurn && (
                      <Form.Item
                        label={intl.formatMessage({ id: 'pages.zwtoken.deposit.targetAddress' })}
                        name="targetAddress"
                        rules={[
                          {
                            required: true,
                            message: intl.formatMessage({
                              id: 'pages.zwtoken.deposit.targetAddress.required',
                            }),
                          },
                          {
                            pattern: /^0x[a-fA-F0-9]{40}$/,
                            message: intl.formatMessage({
                              id: 'pages.zwtoken.transfer.targetAddress.invalid',
                            }),
                          },
                        ]}
                      >
                        <Input
                          placeholder={intl.formatMessage({
                            id: 'pages.zwtoken.deposit.targetAddress.placeholder',
                          })}
                          maxLength={42}
                          addonAfter={
                            <Button
                              type="link"
                              onClick={handleAdvancedDepositGenerateClick}
                              style={{ padding: 0, height: 'auto' }}
                            >
                              {intl.formatMessage({ id: 'pages.zwtoken.deposit.generateBySeed' })}
                            </Button>
                          }
                        />
                      </Form.Item>
                    )}

                    <Form.Item>
                      <Button type="primary" htmlType="submit" loading={loading} block>
                        {advancedNeedsApproval ? 'Approve' : directBurn ? 'Wrap and Burn' : 'Wrap'}
                      </Button>
                    </Form.Item>

                    {/* 显示交易哈希 */}
                    {advancedDepositTxHash && (
                      <div style={{ marginTop: 12, textAlign: 'center' }}>
                        <span style={{ color: '#52c41a', fontSize: '14px' }}>
                          Tx Submitted:{' '}
                          <a
                            href={`https://sepolia.etherscan.io/tx/${advancedDepositTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#1890ff', textDecoration: 'underline' }}
                          >
                            {advancedDepositTxHash.substring(0, 10)}...{advancedDepositTxHash.substring(advancedDepositTxHash.length - 8)}
                          </a>
                        </span>
                      </div>
                    )}
                  </Form>

                  <div
                    style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}
                  >
                    <h4>{intl.formatMessage({ id: 'pages.zwtoken.deposit.tip.title' })}</h4>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.deposit.tip.1' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.deposit.tip.2' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.deposit.tip.3' })}</p>
                    {directBurn && (
                      <p style={{ color: '#faad14', fontWeight: 'bold' }}>
                        {intl.formatMessage({ id: 'pages.zwtoken.deposit.directBurnNote' })}
                      </p>
                    )}
                  </div>
                </div>
              </TabPane>

              <TabPane tab={intl.formatMessage({ id: 'pages.zwtoken.tab.unwrap' })} key="withdraw">
                <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
                  <Form form={withdrawForm} layout="vertical" onFinish={handleWithdraw}>
                    <Form.Item
                      label={intl.formatMessage({ id: 'pages.zwtoken.withdraw.amount' })}
                      name="amount"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.withdraw.amount.required',
                          }),
                        },
                        {
                          type: 'number',
                          min: 0.000001,
                          message: intl.formatMessage({ id: 'pages.zwtoken.withdraw.amount.min' }),
                        },
                      ]}
                    >
                      <InputNumber
                        style={{ width: '100%' }}
                        placeholder={intl.formatMessage({
                          id: 'pages.zwtoken.withdraw.amount.placeholder',
                        })}
                        precision={6}
                        min={0}
                      />
                    </Form.Item>

                    <Form.Item>
                      <Button type="primary" htmlType="submit" loading={loading} block>
                        {intl.formatMessage({ id: 'pages.zwtoken.withdraw.button' })}
                      </Button>
                    </Form.Item>

                    {/* 显示交易哈希 */}
                    {advancedWithdrawTxHash && (
                      <div style={{ marginTop: 12, textAlign: 'center' }}>
                        <span style={{ color: '#52c41a', fontSize: '14px' }}>
                          Tx Submitted:{' '}
                          <a
                            href={`https://sepolia.etherscan.io/tx/${advancedWithdrawTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#1890ff', textDecoration: 'underline' }}
                          >
                            {advancedWithdrawTxHash.substring(0, 10)}...{advancedWithdrawTxHash.substring(advancedWithdrawTxHash.length - 8)}
                          </a>
                        </span>
                      </div>
                    )}
                  </Form>

                  <div
                    style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}
                  >
                    <h4>{intl.formatMessage({ id: 'pages.zwtoken.withdraw.tip.title' })}</h4>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.withdraw.tip.1' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.withdraw.tip.2' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.withdraw.tip.3' })}</p>
                  </div>
                </div>
              </TabPane>

              <TabPane
                tab={intl.formatMessage({ id: 'pages.zwtoken.tab.transfer' })}
                key="transfer"
              >
                <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
                  <Form form={transferForm} layout="vertical" onFinish={handleTransfer}>
                    <Form.Item
                      label={intl.formatMessage({ id: 'pages.zwtoken.transfer.targetAddress' })}
                      name="targetAddress"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.transfer.targetAddress.required',
                          }),
                        },
                        {
                          pattern: /^0x[a-fA-F0-9]{40}$/,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.transfer.targetAddress.invalid',
                          }),
                        },
                      ]}
                    >
                      <Input
                        placeholder={intl.formatMessage({
                          id: 'pages.zwtoken.transfer.targetAddress.placeholder',
                        })}
                        maxLength={42}
                        addonAfter={
                          <Button
                            type="link"
                            onClick={handleBurnClick}
                            style={{ padding: 0, height: 'auto' }}
                          >
                            {intl.formatMessage({ id: 'pages.zwtoken.transfer.burn' })}
                          </Button>
                        }
                      />
                    </Form.Item>

                    <Form.Item
                      label={intl.formatMessage({ id: 'pages.zwtoken.transfer.amount' })}
                      name="amount"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.transfer.amount.required',
                          }),
                        },
                        {
                          type: 'number',
                          min: 0.000001,
                          message: intl.formatMessage({ id: 'pages.zwtoken.transfer.amount.min' }),
                        },
                      ]}
                    >
                      <InputNumber
                        style={{ width: '100%' }}
                        placeholder={intl.formatMessage({
                          id: 'pages.zwtoken.transfer.amount.placeholder',
                        })}
                        precision={6}
                        min={0}
                      />
                    </Form.Item>

                    <Form.Item>
                      <Button type="primary" htmlType="submit" loading={loading} block>
                        {intl.formatMessage({ id: 'pages.zwtoken.transfer.button' })}
                      </Button>
                    </Form.Item>

                    {/* 显示交易哈希 */}
                    {advancedTransferTxHash && (
                      <div style={{ marginTop: 12, textAlign: 'center' }}>
                        <span style={{ color: '#52c41a', fontSize: '14px' }}>
                          Tx Submitted:{' '}
                          <a
                            href={`https://sepolia.etherscan.io/tx/${advancedTransferTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#1890ff', textDecoration: 'underline' }}
                          >
                            {advancedTransferTxHash.substring(0, 10)}...{advancedTransferTxHash.substring(advancedTransferTxHash.length - 8)}
                          </a>
                        </span>
                      </div>
                    )}
                  </Form>

                  <div
                    style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}
                  >
                    <h4>{intl.formatMessage({ id: 'pages.zwtoken.transfer.tip.title' })}</h4>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.transfer.tip.1' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.transfer.tip.2' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.transfer.tip.3' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.transfer.tip.4' })}</p>
                  </div>
                </div>
              </TabPane>

              <TabPane tab={intl.formatMessage({ id: 'pages.zwtoken.tab.remint' })} key="remint">
                <div style={{ maxWidth: 600, margin: '0 auto', padding: '24px 0' }}>
                  <Form form={remintForm} layout="vertical" onFinish={handleRemint}>
                    <Form.Item
                      label={intl.formatMessage({ id: 'pages.zwtoken.remint.secret' })}
                      name="secret"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.remint.secret.required',
                          }),
                        },
                      ]}
                    >
                      <Input.Password
                        placeholder={intl.formatMessage({
                          id: 'pages.zwtoken.remint.secret.placeholder',
                        })}
                        addonAfter={
                          <Button
                            type="link"
                            onClick={handleAdvancedRemintGenerateBySeedClick}
                            style={{ padding: 0, height: 'auto' }}
                          >
                            {intl.formatMessage({ id: 'pages.zwtoken.remint.selectSecretBySeed' })}
                          </Button>
                        }
                      />
                    </Form.Item>

                    <Form.Item
                      label={intl.formatMessage({ id: 'pages.zwtoken.remint.recipient' })}
                      name="recipient"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.remint.recipient.required',
                          }),
                        },
                        {
                          pattern: /^0x[a-fA-F0-9]{40}$/,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.remint.recipient.invalid',
                          }),
                        },
                      ]}
                    >
                      <Input
                        placeholder={intl.formatMessage({
                          id: 'pages.zwtoken.remint.recipient.placeholder',
                        })}
                        maxLength={42}
                      />
                    </Form.Item>

                    <Form.Item
                      label={intl.formatMessage({ id: 'pages.zwtoken.remint.amount' })}
                      name="remintAmount"
                      rules={[
                        {
                          required: true,
                          message: intl.formatMessage({
                            id: 'pages.zwtoken.remint.amount.required',
                          }),
                        },
                        {
                          type: 'number',
                          min: 0.000001,
                          message: intl.formatMessage({ id: 'pages.zwtoken.remint.amount.min' }),
                        },
                      ]}
                    >
                      <InputNumber
                        style={{ width: '100%' }}
                        placeholder={intl.formatMessage({
                          id: 'pages.zwtoken.remint.amount.placeholder',
                        })}
                        precision={6}
                        min={0}
                      />
                    </Form.Item>

                    {selectedRemintMaxAmount && parseFloat(selectedRemintMaxAmount) > 0 && (
                      <div
                        style={{
                          marginTop: -16,
                          marginBottom: 16,
                          color: '#1890ff',
                          fontSize: '12px',
                        }}
                      >
                        💡 {intl.formatMessage({ id: 'pages.zwtoken.remint.maxAmountTip' })}:{' '}
                        {parseInt(selectedRemintMaxAmount)} NFT{parseInt(selectedRemintMaxAmount) > 1 ? 's' : ''}
                      </div>
                    )}

                    <Form.Item name="relayerFee" initialValue={0} hidden>
                      <InputNumber />
                    </Form.Item>

                    <Form.Item name="redeem" valuePropName="checked" initialValue={false}>
                      <Checkbox>
                        {intl.formatMessage({ id: 'pages.zwtoken.remint.redeem' })}
                      </Checkbox>
                    </Form.Item>

                    <Form.Item>
                      <Button type="primary" htmlType="submit" loading={loading} block>
                        {intl.formatMessage({ id: 'pages.zwtoken.remint.button' })}
                      </Button>
                    </Form.Item>

                    {/* 显示交易哈希 */}
                    {advancedRemintTxHash && (
                      <div style={{ marginTop: 12, textAlign: 'center' }}>
                        <span style={{ color: '#52c41a', fontSize: '14px' }}>
                          Tx Submitted:{' '}
                          <a
                            href={`https://sepolia.etherscan.io/tx/${advancedRemintTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: '#1890ff', textDecoration: 'underline' }}
                          >
                            {advancedRemintTxHash.substring(0, 10)}...{advancedRemintTxHash.substring(advancedRemintTxHash.length - 8)}
                          </a>
                        </span>
                      </div>
                    )}
                  </Form>

                  <div
                    style={{ marginTop: 24, padding: 16, background: '#f5f5f5', borderRadius: 4 }}
                  >
                    <h4>{intl.formatMessage({ id: 'pages.zwtoken.remint.tip.title' })}</h4>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.remint.tip.1' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.remint.tip.2' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.remint.tip.3' })}</p>
                    <p>{intl.formatMessage({ id: 'pages.zwtoken.remint.tip.4' })}</p>
                    <p style={{ color: '#1890ff', marginTop: 12 }}>
                      <strong>
                        {intl.formatMessage({ id: 'pages.zwtoken.remint.parameters' })}
                      </strong>
                      <br />
                      {intl.formatMessage({ id: 'pages.zwtoken.remint.redeemDesc' })}
                    </p>
                  </div>
                </div>
              </TabPane>
            </Tabs>
          </TabPane>

          {/* Tutorial Tab */}
          <TabPane tab="Tutorial" key="tutorial">
            <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 0' }}>
              <div
                style={{
                  position: 'relative',
                  paddingBottom: '56.25%' /* 16:9 aspect ratio */,
                  height: 0,
                  overflow: 'hidden',
                  maxWidth: '100%',
                  background: '#000',
                }}
              >
                <iframe
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    border: 0,
                  }}
                  src="https://www.youtube.com/embed/aH_Q9idI2Uw?si=4B99x1e1WapJRQe2&cc_load_policy=1"
                  title="YouTube video player"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
            </div>
          </TabPane>
        </Tabs>
      </Card>

      {/* Deposit Directly Burn Secret Modal - Generate Burn Address */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.title' })}
        open={depositSecretModalVisible}
        onCancel={() => {
          setDepositSecretModalVisible(false);
          depositSecretForm.resetFields();
          setSeed('');
          setDepositSecretList([]);
        }}
        footer={null}
        width={900}
      >
        {/* Use Seed Mode - Show Secret List */}
        {depositSecretList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            <p>{intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.waiting' })}</p>
          </div>
        ) : (
          <div>
            <Table
              dataSource={depositSecretList}
              rowKey="index"
              pagination={false}
              size="small"
              scroll={{ y: 300, x: 'max-content' }}
              columns={[
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.index',
                  }),
                  dataIndex: 'index',
                  key: 'index',
                  width: 80,
                  align: 'center',
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.secret',
                  }),
                  dataIndex: 'secret',
                  key: 'secret',
                  width: 120,
                  ellipsis: true,
                  render: (text: string) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                        {text.substring(0, 4)}...{text.substring(text.length - 4)}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        onClick={async () => {
                          const success = await copyToClipboard(text);
                          if (success) {
                            message.success('Secret copied!');
                          } else {
                            message.error('Failed to copy');
                          }
                        }}
                        style={{ padding: 0, height: 'auto' }}
                        icon={<CopyOutlined />}
                      />
                    </div>
                  ),
                },
                {
                  title: 'Burn Address',
                  dataIndex: 'address',
                  key: 'address',
                  width: 120,
                  ellipsis: true,
                  render: (text: string, record) => {
                    if (record.loading || !text) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                          {text.substring(0, 6)}...{text.substring(text.length - 4)}
                        </span>
                        <Button
                          type="link"
                          size="small"
                          onClick={async () => {
                            const success = await copyToClipboard(text);
                            if (success) {
                              message.success('Address copied!');
                            } else {
                              message.error('Failed to copy');
                            }
                          }}
                          style={{ padding: 0, height: 'auto' }}
                          icon={<CopyOutlined />}
                        />
                      </div>
                    );
                  },
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.amount',
                  }),
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 150,
                  align: 'right',
                  render: (amount: string, record) => {
                    if (record.loading) {
                      return (
                        <span style={{ color: '#999' }}>
                          {intl.formatMessage({
                            id: 'pages.zwtoken.transfer.secretModal.seedList.checking',
                          })}
                        </span>
                      );
                    }
                    if (amount === 'Query failed') {
                      return (
                        <span style={{ color: '#ff4d4f' }}>
                          {intl.formatMessage({
                            id: 'pages.zwtoken.transfer.secretModal.seedList.failed',
                          })}
                        </span>
                      );
                    }
                    const amountNum = parseInt(amount);
                    if (amountNum > 0) {
                      return (
                        <span style={{ color: '#faad14', fontWeight: 'bold' }}>
                          {amountNum} NFT{amountNum > 1 ? 's' : ''}
                        </span>
                      );
                    }
                    // Show different message based on isClaimed status
                    if (record.isClaimed) {
                      return (
                        <span style={{ color: '#999' }}>
                          0 NFT ({intl.formatMessage({ id: 'pages.zwtoken.table.claimed' })})
                        </span>
                      );
                    }
                    return <span style={{ color: '#52c41a' }}>0 NFT</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.table.isClaimed' }),
                  dataIndex: 'isClaimed',
                  key: 'isClaimed',
                  width: 100,
                  align: 'center',
                  render: (isClaimed: boolean, record) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    if (isClaimed) {
                      return (
                        <span style={{ color: '#999', fontWeight: 'bold' }}>
                          {intl.formatMessage({ id: 'pages.zwtoken.table.claimed' })}
                        </span>
                      );
                    }
                    return (
                      <span style={{ color: '#52c41a' }}>
                        {intl.formatMessage({ id: 'pages.zwtoken.table.available' })}
                      </span>
                    );
                  },
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.action',
                  }),
                  key: 'action',
                  width: 100,
                  align: 'center',
                  render: (_, record) => {
                    const amountNum = parseFloat(record.amount);
                    const hasAmount =
                      !record.loading && record.amount !== 'Query failed' && amountNum > 0;
                    return (
                      <Button
                        type={hasAmount ? 'default' : 'primary'}
                        size="small"
                        onClick={() => handleSelectDepositSecret(record.secret)}
                        disabled={record.loading || hasAmount}
                        title={
                          hasAmount
                            ? intl.formatMessage({
                                id: 'pages.zwtoken.transfer.secretModal.seedList.hasAmount',
                              })
                            : intl.formatMessage({
                                id: 'pages.zwtoken.transfer.secretModal.seedList.select',
                              })
                        }
                      >
                        {intl.formatMessage({
                          id: 'pages.zwtoken.transfer.secretModal.seedList.select',
                        })}
                      </Button>
                    );
                  },
                },
              ]}
            />
            <p style={{ marginTop: 8, color: '#999', fontSize: '12px' }}>
              {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.seedList.tip' })}
            </p>
          </div>
        )}
      </Modal>

      {/* Secret Modal - Generate Burn Address (Transfer) */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.title' })}
        open={secretModalVisible}
        onCancel={() => {
          setSecretModalVisible(false);
          secretForm.resetFields();
          setSeed('');
          setSecretList([]);
        }}
        footer={null}
        width={900}
      >
        {/* Mode Selection Buttons */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          <Button
            type={transferSecretMode === 'seed' ? 'primary' : 'default'}
            onClick={() => {
              setTransferSecretMode('seed');
              if (secretList.length === 0) {
                handleGenerateBySeed('transfer');
              }
            }}
            size="large"
            style={{ flex: 1 }}
          >
            {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.useSeed' })}
          </Button>
          <Button
            type={transferSecretMode === 'manual' ? 'primary' : 'default'}
            onClick={() => {
              setTransferSecretMode('manual');
              setSecretList([]);
            }}
            size="large"
            style={{ flex: 1 }}
          >
            {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.manual' })}
          </Button>
        </div>

        {/* Manual Input Mode */}
        {transferSecretMode === 'manual' && (
          <div>
            <Form form={secretForm} layout="vertical">
              <Form.Item
                label={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.secret' })}
                name="secret"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.zwtoken.transfer.secretModal.secret.required',
                    }),
                  },
                  {
                    pattern: /^\d+$/,
                    message: intl.formatMessage({
                      id: 'pages.zwtoken.transfer.secretModal.secret.invalid',
                    }),
                  },
                ]}
              >
                <Input
                  placeholder={intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.secret.placeholder',
                  })}
                />
              </Form.Item>
              <Button type="primary" onClick={handleSecretConfirm} block size="large">
                {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.confirm' })}
              </Button>
            </Form>
            <p style={{ color: '#666', fontSize: '12px', marginTop: 12 }}>
              {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.tip' })}
            </p>
          </div>
        )}

        {/* Use Seed Mode - Show Secret List */}
        {transferSecretMode === 'seed' && secretList.length > 0 && (
          <div>
            <Table
              dataSource={secretList}
              rowKey="index"
              pagination={false}
              size="small"
              scroll={{ y: 300, x: 'max-content' }}
              columns={[
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.index',
                  }),
                  dataIndex: 'index',
                  key: 'index',
                  width: 80,
                  align: 'center',
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.secret',
                  }),
                  dataIndex: 'secret',
                  key: 'secret',
                  width: 120,
                  ellipsis: true,
                  render: (text: string) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                        {text.substring(0, 4)}...{text.substring(text.length - 4)}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        onClick={async () => {
                          const success = await copyToClipboard(text);
                          if (success) {
                            message.success('Secret copied!');
                          } else {
                            message.error('Failed to copy');
                          }
                        }}
                        style={{ padding: 0, height: 'auto' }}
                        icon={<CopyOutlined />}
                      />
                    </div>
                  ),
                },
                {
                  title: 'Burn Address',
                  dataIndex: 'address',
                  key: 'address',
                  width: 120,
                  ellipsis: true,
                  render: (text: string, record) => {
                    if (record.loading || !text) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                          {text.substring(0, 6)}...{text.substring(text.length - 4)}
                        </span>
                        <Button
                          type="link"
                          size="small"
                          onClick={async () => {
                            const success = await copyToClipboard(text);
                            if (success) {
                              message.success('Address copied!');
                            } else {
                              message.error('Failed to copy');
                            }
                          }}
                          style={{ padding: 0, height: 'auto' }}
                          icon={<CopyOutlined />}
                        />
                      </div>
                    );
                  },
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.amount',
                  }),
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 150,
                  align: 'right',
                  render: (amount: string, record) => {
                    if (record.loading) {
                      return (
                        <span style={{ color: '#999' }}>
                          {intl.formatMessage({
                            id: 'pages.zwtoken.transfer.secretModal.seedList.checking',
                          })}
                        </span>
                      );
                    }
                    if (amount === 'Query failed') {
                      return (
                        <span style={{ color: '#ff4d4f' }}>
                          {intl.formatMessage({
                            id: 'pages.zwtoken.transfer.secretModal.seedList.failed',
                          })}
                        </span>
                      );
                    }
                    const amountNum = parseInt(amount);
                    if (amountNum > 0) {
                      return (
                        <span style={{ color: '#faad14', fontWeight: 'bold' }}>
                          {amountNum} NFT{amountNum > 1 ? 's' : ''}
                        </span>
                      );
                    }
                    // Show different message based on isClaimed status
                    if (record.isClaimed) {
                      return (
                        <span style={{ color: '#999' }}>
                          0 NFT ({intl.formatMessage({ id: 'pages.zwtoken.table.claimed' })})
                        </span>
                      );
                    }
                    return <span style={{ color: '#52c41a' }}>0 NFT</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.table.isClaimed' }),
                  dataIndex: 'isClaimed',
                  key: 'isClaimed',
                  width: 100,
                  align: 'center',
                  render: (isClaimed: boolean, record) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    if (isClaimed) {
                      return (
                        <span style={{ color: '#999', fontWeight: 'bold' }}>
                          {intl.formatMessage({ id: 'pages.zwtoken.table.claimed' })}
                        </span>
                      );
                    }
                    return (
                      <span style={{ color: '#52c41a' }}>
                        {intl.formatMessage({ id: 'pages.zwtoken.table.available' })}
                      </span>
                    );
                  },
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.action',
                  }),
                  key: 'action',
                  width: 100,
                  align: 'center',
                  render: (_, record) => {
                    const amountNum = parseFloat(record.amount);
                    const hasAmount =
                      !record.loading && record.amount !== 'Query failed' && amountNum > 0;
                    return (
                      <Button
                        type={hasAmount ? 'default' : 'primary'}
                        size="small"
                        onClick={() => handleSelectSecret(record.secret)}
                        disabled={record.loading || hasAmount}
                        title={
                          hasAmount
                            ? intl.formatMessage({
                                id: 'pages.zwtoken.transfer.secretModal.seedList.hasAmount',
                              })
                            : intl.formatMessage({
                                id: 'pages.zwtoken.transfer.secretModal.seedList.select',
                              })
                        }
                      >
                        {intl.formatMessage({
                          id: 'pages.zwtoken.transfer.secretModal.seedList.select',
                        })}
                      </Button>
                    );
                  },
                },
              ]}
            />
            <p style={{ marginTop: 8, color: '#999', fontSize: '12px' }}>
              {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.seedList.tip' })}
            </p>
          </div>
        )}
      </Modal>

      {/* Advanced Mode Deposit Secret Modal - Generate Burn Address */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.title' })}
        open={advancedDepositSecretModalVisible}
        onCancel={() => {
          setAdvancedDepositSecretModalVisible(false);
          advancedDepositSecretForm.resetFields();
          setSeed('');
          setAdvancedDepositSecretList([]);
          setAdvancedDepositSecretMode(undefined);
        }}
        footer={null}
        width={900}
      >
        {/* Mode Selection Buttons */}
        <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
          <Button
            type={advancedDepositSecretMode === 'seed' ? 'primary' : 'default'}
            onClick={() => {
              setAdvancedDepositSecretMode('seed');
              if (advancedDepositSecretList.length === 0) {
                handleGenerateBySeed('advancedDeposit');
              }
            }}
            size="large"
            style={{ flex: 1 }}
          >
            {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.useSeed' })}
          </Button>
          <Button
            type={advancedDepositSecretMode === 'manual' ? 'primary' : 'default'}
            onClick={() => {
              setAdvancedDepositSecretMode('manual');
              setAdvancedDepositSecretList([]);
            }}
            size="large"
            style={{ flex: 1 }}
          >
            {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.manual' })}
          </Button>
        </div>

        {/* Manual Input Mode */}
        {advancedDepositSecretMode === 'manual' && (
          <div>
            <Form form={advancedDepositSecretForm} layout="vertical">
              <Form.Item
                label={intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.secret' })}
                name="secret"
                rules={[
                  {
                    required: true,
                    message: intl.formatMessage({
                      id: 'pages.zwtoken.transfer.secretModal.secret.required',
                    }),
                  },
                  {
                    pattern: /^\d+$/,
                    message: intl.formatMessage({
                      id: 'pages.zwtoken.transfer.secretModal.secret.invalid',
                    }),
                  },
                ]}
              >
                <Input
                  placeholder={intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.secret.placeholder',
                  })}
                />
              </Form.Item>
              <Button
                type="primary"
                onClick={handleAdvancedDepositSecretConfirm}
                block
                size="large"
              >
                {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.confirm' })}
              </Button>
            </Form>
            <p style={{ color: '#666', fontSize: '12px', marginTop: 12 }}>
              {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.tip' })}
            </p>
          </div>
        )}

        {/* Use Seed Mode - Show Secret List */}
        {advancedDepositSecretMode === 'seed' && advancedDepositSecretList.length > 0 && (
          <div>
            <Table
              dataSource={advancedDepositSecretList}
              rowKey="index"
              pagination={false}
              size="small"
              scroll={{ y: 300, x: 'max-content' }}
              columns={[
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.index',
                  }),
                  dataIndex: 'index',
                  key: 'index',
                  width: 80,
                  align: 'center',
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.secret',
                  }),
                  dataIndex: 'secret',
                  key: 'secret',
                  width: 120,
                  ellipsis: true,
                  render: (text: string) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                        {text.substring(0, 4)}...{text.substring(text.length - 4)}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        onClick={async () => {
                          const success = await copyToClipboard(text);
                          if (success) {
                            message.success('Secret copied!');
                          } else {
                            message.error('Failed to copy');
                          }
                        }}
                        style={{ padding: 0, height: 'auto' }}
                        icon={<CopyOutlined />}
                      />
                    </div>
                  ),
                },
                {
                  title: 'Burn Address',
                  dataIndex: 'address',
                  key: 'address',
                  width: 120,
                  ellipsis: true,
                  render: (text: string, record) => {
                    if (record.loading || !text) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                          {text.substring(0, 6)}...{text.substring(text.length - 4)}
                        </span>
                        <Button
                          type="link"
                          size="small"
                          onClick={async () => {
                            const success = await copyToClipboard(text);
                            if (success) {
                              message.success('Address copied!');
                            } else {
                              message.error('Failed to copy');
                            }
                          }}
                          style={{ padding: 0, height: 'auto' }}
                          icon={<CopyOutlined />}
                        />
                      </div>
                    );
                  },
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.amount',
                  }),
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 150,
                  align: 'right',
                  render: (amount: string, record) => {
                    if (record.loading) {
                      return (
                        <span style={{ color: '#999' }}>
                          {intl.formatMessage({
                            id: 'pages.zwtoken.transfer.secretModal.seedList.checking',
                          })}
                        </span>
                      );
                    }
                    if (amount === 'Query failed') {
                      return (
                        <span style={{ color: '#ff4d4f' }}>
                          {intl.formatMessage({
                            id: 'pages.zwtoken.transfer.secretModal.seedList.failed',
                          })}
                        </span>
                      );
                    }
                    const amountNum = parseInt(amount);
                    if (amountNum > 0) {
                      return (
                        <span style={{ color: '#faad14', fontWeight: 'bold' }}>
                          {amountNum} NFT{amountNum > 1 ? 's' : ''}
                        </span>
                      );
                    }
                    // Show different message based on isClaimed status
                    if (record.isClaimed) {
                      return (
                        <span style={{ color: '#999' }}>
                          0 NFT ({intl.formatMessage({ id: 'pages.zwtoken.table.claimed' })})
                        </span>
                      );
                    }
                    return <span style={{ color: '#52c41a' }}>0 NFT</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.table.isClaimed' }),
                  dataIndex: 'isClaimed',
                  key: 'isClaimed',
                  width: 100,
                  align: 'center',
                  render: (isClaimed: boolean, record) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    if (isClaimed) {
                      return (
                        <span style={{ color: '#999', fontWeight: 'bold' }}>
                          {intl.formatMessage({ id: 'pages.zwtoken.table.claimed' })}
                        </span>
                      );
                    }
                    return (
                      <span style={{ color: '#52c41a' }}>
                        {intl.formatMessage({ id: 'pages.zwtoken.table.available' })}
                      </span>
                    );
                  },
                },
                {
                  title: intl.formatMessage({
                    id: 'pages.zwtoken.transfer.secretModal.seedList.action',
                  }),
                  key: 'action',
                  width: 100,
                  align: 'center',
                  render: (_, record) => {
                    const amountNum = parseFloat(record.amount);
                    const hasAmount =
                      !record.loading && record.amount !== 'Query failed' && amountNum > 0;
                    return (
                      <Button
                        type={hasAmount ? 'default' : 'primary'}
                        size="small"
                        onClick={() => handleSelectAdvancedDepositSecret(record.secret)}
                        disabled={record.loading || hasAmount}
                        title={
                          hasAmount
                            ? intl.formatMessage({
                                id: 'pages.zwtoken.transfer.secretModal.seedList.hasAmount',
                              })
                            : intl.formatMessage({
                                id: 'pages.zwtoken.transfer.secretModal.seedList.select',
                              })
                        }
                      >
                        {intl.formatMessage({
                          id: 'pages.zwtoken.transfer.secretModal.seedList.select',
                        })}
                      </Button>
                    );
                  },
                },
              ]}
            />
            <p style={{ marginTop: 8, color: '#999', fontSize: '12px' }}>
              {intl.formatMessage({ id: 'pages.zwtoken.transfer.secretModal.seedList.tip' })}
            </p>
          </div>
        )}
      </Modal>

      {/* Remint page Seed generation Modal - Simple Mode */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.title' })}
        open={remintSeedModalVisible}
        onCancel={() => {
          setRemintSeedModalVisible(false);
          setRemintSecretList([]);
        }}
        footer={[
          <Button key="close" onClick={() => setRemintSeedModalVisible(false)}>
            {intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.close' })}
          </Button>,
        ]}
        width={1000}
      >
        {remintSecretList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            <p>{intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.waiting' })}</p>
          </div>
        ) : (
          <div>
            <Table
              dataSource={remintSecretList}
              rowKey="index"
              pagination={false}
              size="small"
              scroll={{ y: 400, x: 'max-content' }}
              columns={[
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.index' }),
                  dataIndex: 'index',
                  key: 'index',
                  width: 80,
                  align: 'center',
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.secret' }),
                  dataIndex: 'secret',
                  key: 'secret',
                  width: 120,
                  ellipsis: true,
                  render: (text: string) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                        {text.substring(0, 4)}...{text.substring(text.length - 4)}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        onClick={async () => {
                          const success = await copyToClipboard(text);
                          if (success) {
                            message.success('Secret copied!');
                          } else {
                            message.error('Failed to copy');
                          }
                        }}
                        style={{ padding: 0, height: 'auto' }}
                        icon={<CopyOutlined />}
                      />
                    </div>
                  ),
                },
                {
                  title: 'Burn Address',
                  dataIndex: 'address',
                  key: 'address',
                  width: 120,
                  ellipsis: true,
                  render: (text: string, record) => {
                    if (record.loading || !text) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                          {text.substring(0, 6)}...{text.substring(text.length - 4)}
                        </span>
                        <Button
                          type="link"
                          size="small"
                          onClick={async () => {
                            const success = await copyToClipboard(text);
                            if (success) {
                              message.success('Address copied!');
                            } else {
                              message.error('Failed to copy');
                            }
                          }}
                          style={{ padding: 0, height: 'auto' }}
                          icon={<CopyOutlined />}
                        />
                      </div>
                    );
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.amount' }),
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 150,
                  align: 'right',
                  render: (amount: string, record) => {
                    if (record.loading) {
                      return (
                        <span style={{ color: '#999' }}>
                          {intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.checking' })}
                        </span>
                      );
                    }
                    if (amount === 'Query failed') {
                      return (
                        <span style={{ color: '#ff4d4f' }}>
                          {intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.failed' })}
                        </span>
                      );
                    }
                    const amountNum = parseFloat(amount);
                    if (amountNum > 0) {
                      return (
                        <span style={{ color: '#52c41a', fontWeight: 'bold' }}>
                          {parseFloat(amount).toFixed(6)} USDC
                        </span>
                      );
                    }
                    // Show different message based on isClaimed status
                    if (record.isClaimed) {
                      return (
                        <span style={{ color: '#999' }}>
                          0 USDC ({intl.formatMessage({ id: 'pages.zwtoken.table.reminted' })})
                        </span>
                      );
                    }
                    return <span style={{ color: '#52c41a' }}>0 USDC</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.table.isReminted' }),
                  dataIndex: 'isClaimed',
                  key: 'isClaimed',
                  width: 100,
                  align: 'center',
                  render: (isClaimed: boolean, record) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    if (isClaimed) {
                      return (
                        <span style={{ color: '#999', fontWeight: 'bold' }}>
                          {intl.formatMessage({ id: 'pages.zwtoken.table.reminted' })}
                        </span>
                      );
                    }
                    return (
                      <span style={{ color: '#52c41a' }}>
                        {intl.formatMessage({ id: 'pages.zwtoken.table.available' })}
                      </span>
                    );
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.action' }),
                  key: 'action',
                  width: 100,
                  align: 'center',
                  render: (_, record) => (
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => handleSelectRemintSecret(record.secret, record.amount)}
                      disabled={record.loading}
                    >
                      {intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.select' })}
                    </Button>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Modal>

      {/* Remint page Seed generation Modal - Advanced Mode */}
      <Modal
        title={intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.title' })}
        open={advancedRemintSeedModalVisible}
        onCancel={() => {
          setAdvancedRemintSeedModalVisible(false);
          setAdvancedRemintSecretList([]);
        }}
        footer={[
          <Button key="close" onClick={() => setAdvancedRemintSeedModalVisible(false)}>
            {intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.close' })}
          </Button>,
        ]}
        width={1000}
      >
        {advancedRemintSecretList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            <p>{intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.waiting' })}</p>
          </div>
        ) : (
          <div>
            <Table
              dataSource={advancedRemintSecretList}
              rowKey="index"
              pagination={false}
              size="small"
              scroll={{ y: 400, x: 'max-content' }}
              columns={[
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.index' }),
                  dataIndex: 'index',
                  key: 'index',
                  width: 80,
                  align: 'center',
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.secret' }),
                  dataIndex: 'secret',
                  key: 'secret',
                  width: 120,
                  ellipsis: true,
                  render: (text: string) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                        {text.substring(0, 4)}...{text.substring(text.length - 4)}
                      </span>
                      <Button
                        type="link"
                        size="small"
                        onClick={async () => {
                          const success = await copyToClipboard(text);
                          if (success) {
                            message.success('Secret copied!');
                          } else {
                            message.error('Failed to copy');
                          }
                        }}
                        style={{ padding: 0, height: 'auto' }}
                        icon={<CopyOutlined />}
                      />
                    </div>
                  ),
                },
                {
                  title: 'Burn Address',
                  dataIndex: 'address',
                  key: 'address',
                  width: 120,
                  ellipsis: true,
                  render: (text: string, record) => {
                    if (record.loading || !text) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', flex: 1 }}>
                          {text.substring(0, 6)}...{text.substring(text.length - 4)}
                        </span>
                        <Button
                          type="link"
                          size="small"
                          onClick={async () => {
                            const success = await copyToClipboard(text);
                            if (success) {
                              message.success('Address copied!');
                            } else {
                              message.error('Failed to copy');
                            }
                          }}
                          style={{ padding: 0, height: 'auto' }}
                          icon={<CopyOutlined />}
                        />
                      </div>
                    );
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.amount' }),
                  dataIndex: 'amount',
                  key: 'amount',
                  width: 150,
                  align: 'right',
                  render: (amount: string, record) => {
                    if (record.loading) {
                      return (
                        <span style={{ color: '#999' }}>
                          {intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.checking' })}
                        </span>
                      );
                    }
                    if (amount === 'Query failed') {
                      return (
                        <span style={{ color: '#ff4d4f' }}>
                          {intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.failed' })}
                        </span>
                      );
                    }
                    const amountNum = parseInt(amount);
                    if (amountNum > 0) {
                      return (
                        <span style={{ color: '#52c41a', fontWeight: 'bold' }}>
                          {amountNum} NFT{amountNum > 1 ? 's' : ''}
                        </span>
                      );
                    }
                    // Show different message based on isClaimed status
                    if (record.isClaimed) {
                      return (
                        <span style={{ color: '#999' }}>
                          0 NFT ({intl.formatMessage({ id: 'pages.zwtoken.table.reminted' })})
                        </span>
                      );
                    }
                    return <span style={{ color: '#52c41a' }}>0 NFT</span>;
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.table.isReminted' }),
                  dataIndex: 'isClaimed',
                  key: 'isClaimed',
                  width: 100,
                  align: 'center',
                  render: (isClaimed: boolean, record) => {
                    if (record.loading) {
                      return <span style={{ color: '#999' }}>-</span>;
                    }
                    if (isClaimed) {
                      return (
                        <span style={{ color: '#999', fontWeight: 'bold' }}>
                          {intl.formatMessage({ id: 'pages.zwtoken.table.reminted' })}
                        </span>
                      );
                    }
                    return (
                      <span style={{ color: '#52c41a' }}>
                        {intl.formatMessage({ id: 'pages.zwtoken.table.available' })}
                      </span>
                    );
                  },
                },
                {
                  title: intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.action' }),
                  key: 'action',
                  width: 100,
                  align: 'center',
                  render: (_, record) => (
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => handleAdvancedRemintSelectSecret(record.secret, record.amount)}
                      disabled={record.loading}
                    >
                      {intl.formatMessage({ id: 'pages.zwtoken.remint.seedModal.select' })}
                    </Button>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Modal>
    </PageContainer>
  );
};

export default ZWToken;
